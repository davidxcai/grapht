'use client';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string | null;
}

export function MultiSelect({
  id,
  value,
  options,
  placeholder,
  summary,
  className,
  onChange,
}: {
  id?: string;
  value: string[];
  options: MultiSelectOption[];
  placeholder: string;
  summary: (value: string[]) => string;
  className?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <Select
      multiple
      value={value}
      onValueChange={(next: unknown) => onChange(next as string[])}
    >
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <span className={value.length === 0 ? 'text-muted-foreground' : undefined}>
          {value.length === 0 ? placeholder : summary(value)}
        </span>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            {option.hint && (
              <span className="ml-auto pl-3 text-xs text-muted-foreground">{option.hint}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
