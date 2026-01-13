import { createHash, createHmac } from "node:crypto";
import { loadEnv } from "../config";
import { joinOrEmpty, nowInTz } from "../utils";
import type { DamaiProject } from "../types";

export type DamaiSearchFilters = {
  categories?: string[];
  subCategories?: string[];
  artists?: string[];
  keywords?: string[];
  cities?: string[];
  dateType?: number;
  startDate?: string;
  endDate?: string;
  channels?: string[];
  pageNumber?: number;
  pageSize?: number;
  sortType?: number;
};

type DamaiResponse = {
  alibaba_damai_ec_search_project_search_response?: {
    result?: {
      success?: boolean;
      error_msg?: string;
      model?: {
        projects?: {
          project_dto?: DamaiProject[] | DamaiProject;
        };
      };
    };
  };
  error_response?: {
    msg?: string;
    sub_msg?: string;
    code?: number;
    sub_code?: string;
  };
};

const buildSignature = (params: Record<string, string>, secret: string, method: "md5" | "hmac") => {
  const sortedKeys = Object.keys(params).sort();
  const raw = sortedKeys.map((key) => `${key}${params[key]}`).join("");
  if (method === "hmac") {
    return createHmac("md5", secret).update(raw).digest("hex").toUpperCase();
  }
  return createHash("md5").update(`${secret}${raw}${secret}`).digest("hex").toUpperCase();
};

export const searchDamaiProjects = async (filters: DamaiSearchFilters) => {
  const env = loadEnv();
  if (!env.damaiAppKey || !env.damaiAppSecret) {
    throw new Error("Missing DAMAI_APP_KEY or DAMAI_APP_SECRET");
  }

  const timestamp = nowInTz(env.timezone);
  const param = {
    category_name: joinOrEmpty(filters.categories),
    sub_category_name: joinOrEmpty(filters.subCategories),
    artist_name: joinOrEmpty(filters.artists),
    keyword: joinOrEmpty(filters.keywords),
    filter_city_name: joinOrEmpty(filters.cities),
    sort_type: filters.sortType,
    date_type: filters.dateType,
    start_date: filters.startDate,
    end_date: filters.endDate,
    channel: joinOrEmpty(filters.channels),
    page_number: filters.pageNumber || 1,
    page_size: filters.pageSize || 10
  };

  const params: Record<string, string> = {
    method: "alibaba.damai.ec.search.project.search",
    app_key: env.damaiAppKey,
    sign_method: env.damaiSignMethod,
    timestamp,
    format: "json",
    v: "2.0",
    simplify: "true",
    param: JSON.stringify(param)
  };

  const sign = buildSignature(params, env.damaiAppSecret, env.damaiSignMethod);
  params.sign = sign;

  const body = new URLSearchParams(params);
  const response = await fetch(env.damaiBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as DamaiResponse;
  if (payload.error_response) {
    const err = payload.error_response;
    throw new Error(`Damai API error ${err.code || ""} ${err.sub_code || ""}: ${err.sub_msg || err.msg || "unknown"}`);
  }

  const result = payload.alibaba_damai_ec_search_project_search_response?.result;
  if (!result?.success) {
    throw new Error(`Damai API failed: ${result?.error_msg || "unknown"}`);
  }

  const dto = result.model?.projects?.project_dto;
  if (!dto) return [] as DamaiProject[];
  return Array.isArray(dto) ? dto : [dto];
};
