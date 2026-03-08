#!/usr/bin/env bun

import assert from "node:assert/strict";

type EventRecord = {
  id?: number;
  title?: string;
  cityName?: string;
  performers?: string;
  showTime?: string;
  soldOut?: number;
};

const baseUrl = Bun.env.API_BASE_URL || "http://127.0.0.1:9826";
const keyword = Bun.env.EVENTS_KEYWORD || "";
const city = Bun.env.EVENTS_CITY || "";
const artist = Bun.env.EVENTS_ARTIST || "";

const getJson = async (path: string) => {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200, `GET ${path} failed with ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/json"), `GET ${path} did not return JSON`);
  const data = await response.json();
  assert.ok(Array.isArray(data), `GET ${path} did not return an array`);
  return data as EventRecord[];
};

const includesText = (value: string | undefined, text: string) =>
  (value || "").toLowerCase().includes(text.toLowerCase());

const assertSortedByShowTimeDesc = (events: EventRecord[]) => {
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1]?.showTime || "";
    const next = events[i]?.showTime || "";
    assert.ok(prev >= next, `showTime sort failed at index ${i - 1} -> ${i}`);
  }
};

const main = async () => {
  console.log(`Testing ${baseUrl}/api/events`);

  const allEvents = await getJson("/api/events?limit=5");
  console.log(`default query: ${allEvents.length} events`);

  const limitedEvents = await getJson("/api/events?limit=2");
  assert.ok(limitedEvents.length <= 2, "limit=2 returned more than 2 events");
  console.log(`limit works: ${limitedEvents.length} events`);

  const soldOutEvents = await getJson("/api/events?soldOut=1&limit=20");
  for (const event of soldOutEvents) {
    assert.equal(event.soldOut, 1, "soldOut=1 returned a non sold-out event");
  }
  console.log(`soldOut filter works: ${soldOutEvents.length} events`);

  const showTimeEvents = await getJson("/api/events?sort=showTime&limit=20");
  assertSortedByShowTimeDesc(showTimeEvents);
  console.log(`showTime sort works: ${showTimeEvents.length} events`);

  if (keyword) {
    const events = await getJson(`/api/events?keyword=${encodeURIComponent(keyword)}&limit=20`);
    for (const event of events) {
      assert.ok(
        includesText(event.title, keyword) || includesText(event.performers, keyword),
        `keyword filter failed for event ${event.id || event.title || "<unknown>"}`
      );
    }
    console.log(`keyword filter works for "${keyword}": ${events.length} events`);
  }

  if (city) {
    const events = await getJson(`/api/events?city=${encodeURIComponent(city)}&limit=20`);
    for (const event of events) {
      assert.ok(
        includesText(event.cityName, city),
        `city filter failed for event ${event.id || event.title || "<unknown>"}`
      );
    }
    console.log(`city filter works for "${city}": ${events.length} events`);
  }

  if (artist) {
    const events = await getJson(`/api/events?artist=${encodeURIComponent(artist)}&limit=20`);
    for (const event of events) {
      assert.ok(
        includesText(event.performers, artist),
        `artist filter failed for event ${event.id || event.title || "<unknown>"}`
      );
    }
    console.log(`artist filter works for "${artist}": ${events.length} events`);
  }

  await getJson("/api/events?since=2026-01-01T00:00:00.000Z&until=2026-12-31T23:59:59.999Z&limit=5");
  console.log("since/until query returned JSON successfully");

  console.log("events api check passed");
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
