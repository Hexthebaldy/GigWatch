import { useEffect, useRef, useState } from "react";
import type { DictEntry, MonitoringPayload } from "@gigwatch/shared";
import { useStore } from "../../store";
import { Close } from "../ui/Icon";
import "./ConfigDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DictField = ({
  label,
  dict,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  dict: DictEntry[];
  selected: string[];
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) => {
  const nameMap = new Map(dict.map((d) => [d.code, d.name]));
  const available = dict.filter((d) => !selected.includes(d.code));

  return (
    <div className="config-field">
      <span className="config-field__label">{label}</span>
      <div className="config-field__tags">
        {selected.map((code) => (
          <span key={code} className="config-tag">
            <span className="config-tag__text">{nameMap.get(code) ?? code}</span>
            <button className="config-tag__remove" onClick={() => onRemove(code)}>×</button>
          </span>
        ))}
        {available.length > 0 && (
          <select
            className="config-field__select"
            value=""
            onChange={(e) => {
              if (e.target.value) onAdd(e.target.value);
            }}
          >
            <option value="">添加…</option>
            {available.map((d) => (
              <option key={d.code} value={d.code}>{d.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};

const TextField = ({
  label,
  placeholder,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) => {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) {
      onAdd(v);
    }
    setDraft("");
  };

  return (
    <div className="config-field">
      <span className="config-field__label">{label}</span>
      <div className="config-field__tags">
        {items.map((item) => (
          <span key={item} className="config-tag">
            <span className="config-tag__text">{item}</span>
            <button className="config-tag__remove" onClick={() => onRemove(item)}>×</button>
          </span>
        ))}
        <input
          className="config-field__text-input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
};

export const ConfigDialog = ({ open, onClose }: Props) => {
  const store = useStore();
  const [form, setForm] = useState<MonitoringPayload>({
    focusArtists: [],
    cityCodes: [],
    showStyles: [],
    keywords: [],
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string; key: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Mount/unmount with fade animation — only reset form when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      setForm({ ...store.monitoring });
      setToast(null);
    } else if (!open) {
      setVisible(false);
    }
    prevOpenRef.current = open;
  }, [open, store.monitoring]);

  const handleTransitionEnd = () => {
    if (!visible) setMounted(false);
  };

  const update = <K extends keyof MonitoringPayload>(key: K, value: MonitoringPayload[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const showToast = (type: "success" | "error", text: string) => {
    const key = Date.now();
    setToast({ type, text, key });
    setTimeout(() => setToast((t) => (t?.key === key ? null : t)), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await store.saveMonitoring(form);
      showToast("success", "保存成功");
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  if (!mounted) return null;

  return (
    <>
      {toast && (
        <div key={toast.key} className={`config-toast config-toast--${toast.type}`}>
          {toast.text}
        </div>
      )}
      <div
        className={`config-backdrop ${visible ? "config-backdrop--visible" : ""}`}
        ref={backdropRef}
        onClick={handleBackdropClick}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="config-dialog">
          <header className="config-dialog__header">
            <h2 className="config-dialog__title">订阅配置</h2>
            <button className="config-dialog__close" onClick={onClose}>
              <Close size={18} />
            </button>
          </header>

          <div className="config-dialog__body">
            <TextField
              label="关注艺人"
              placeholder="输入艺人名，回车添加"
              items={form.focusArtists}
              onAdd={(v) => update("focusArtists", [...form.focusArtists, v])}
              onRemove={(v) => update("focusArtists", form.focusArtists.filter((x) => x !== v))}
            />
            <DictField
              label="监控城市"
              dict={store.cities}
              selected={form.cityCodes}
              onAdd={(code) => update("cityCodes", [...form.cityCodes, code])}
              onRemove={(code) => update("cityCodes", form.cityCodes.filter((c) => c !== code))}
            />
            <DictField
              label="演出类型"
              dict={store.showStyles}
              selected={form.showStyles}
              onAdd={(code) => update("showStyles", [...form.showStyles, code])}
              onRemove={(code) => update("showStyles", form.showStyles.filter((c) => c !== code))}
            />
            <TextField
              label="关键词"
              placeholder="输入关键词，回车添加"
              items={form.keywords}
              onAdd={(v) => update("keywords", [...form.keywords, v])}
              onRemove={(v) => update("keywords", form.keywords.filter((x) => x !== v))}
            />
          </div>

          <footer className="config-dialog__footer">
            <button className="config-dialog__btn config-dialog__btn--cancel" onClick={onClose}>
              取消
            </button>
            <button
              className="config-dialog__btn config-dialog__btn--save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
};
