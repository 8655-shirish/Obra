import { useRef, useState } from "react";

import "./painter-template-dialog.css";

const items = [
  "Rooms and surfaces to include",
  "Existing coatings and visible repairs",
  "Colour, sheen and material references",
  "Protection, ventilation and daily access",
  "Timing, drying and cure guidance",
  "Questions for the written quote",
];

export function PainterProjectPlanner({ className = "" }: { className?: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const fallback = useRef<HTMLTextAreaElement>(null);
  const text = `Painting project notes\n${selected.map((item) => `- ${item}`).join("\n")}${notes.trim() ? `\n\n${notes.trim()}` : ""}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("manual");
      requestAnimationFrame(() => fallback.current?.focus());
    }
  }

  return (
    <div className={`pt-planner ${className}`}>
      <p>Your notes stay on this page. Nothing is sent or booked.</p>
      <fieldset>
        <legend>Include in my project list</legend>
        {items.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={selected.includes(item)}
              onChange={() => {
                setStatus("idle");
                setSelected((current) =>
                  current.includes(item)
                    ? current.filter((value) => value !== item)
                    : [...current, item],
                );
              }}
            />
            <span>{item}</span>
          </label>
        ))}
      </fieldset>
      <label className="pt-planner-notes">
        Anything particular to the project
        <textarea
          rows={3}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setStatus("idle");
          }}
        />
      </label>
      <button
        type="button"
        disabled={!selected.length && !notes.trim()}
        onClick={() => void copy()}
      >
        Copy my list
      </button>
      <p role="status">
        {status === "copied"
          ? "Copied. Your list is ready to share with your painter."
          : status === "manual"
            ? "Clipboard access is unavailable. Select and copy your list below."
            : "Choose a topic or add a note to create your list."}
      </p>
      {status === "manual" ? (
        <label className="pt-planner-notes">
          Your list
          <textarea
            ref={fallback}
            readOnly
            rows={6}
            value={text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
    </div>
  );
}
