'use client';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/multi-select';
import { CONCERNS, concernLabel, orderConcerns } from '@/lib/concerns';
import type { RankedConcern } from '@/lib/routines';

/**
 * All fourteen concerns are always offered — narrowing the list would hide the
 * metric a routine confounds by accident (docs/trial-model.md). The pre-ticked
 * subset stays capped at three; broad targets make `|T| > 1` fire on every
 * metric and empty the attribution table (rule 9).
 */
export function ConcernPicker({
  targets,
  note,
  label,
  onChange,
}: {
  targets: string[];
  note: string | null;
  label: string;
  onChange: (targets: string[]) => void;
}) {
  const options = CONCERNS.map((concern) => ({
    value: concern,
    label: concernLabel(concern),
  }));

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>

      <MultiSelect
        value={targets}
        options={options}
        placeholder="Choose metrics"
        summary={(v) => `${v.length} selected`}
        onChange={(next) => onChange(orderConcerns(next))}
      />

      {targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {targets.map((concern) => (
            <li key={concern}>
              <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                {concernLabel(concern)}
                <button
                  type="button"
                  aria-label={`Stop watching ${concernLabel(concern)}`}
                  className="rounded-full p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100"
                  onClick={() => onChange(targets.filter((c) => c !== concern))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
