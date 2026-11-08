"use client";

import { useState } from "react";

export type TourStep = { title: string; text: string; image: string; alt: string };

/** A step list beside a screenshot; picking a step shows its screen. Stacks on phones. */
export function TourJourney({ id, label, steps }: { id: string; label: string; steps: TourStep[] }) {
  const [active, setActive] = useState(0);
  const step = steps[active];
  return (
    <div className="tour-journey">
      <ol className="tour-steps" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              className={i === active ? "tour-step active" : "tour-step"}
              aria-current={i === active ? "step" : undefined}
              aria-controls={`${id}-shot`}
              onClick={() => setActive(i)}
            >
              <span className="tour-num">{i + 1}</span>
              <span>
                <strong>{s.title}</strong>
                <span className="tour-text">{s.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <figure className="tour-shot" id={`${id}-shot`} aria-live="polite">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.image} alt={step.alt} width={1280} height={800} />
        <figcaption>
          Step {active + 1} of {steps.length} · {step.title}
          {active < steps.length - 1 ? (
            <button type="button" className="linkbtn" onClick={() => setActive(active + 1)}>
              Next step →
            </button>
          ) : null}
        </figcaption>
      </figure>
    </div>
  );
}
