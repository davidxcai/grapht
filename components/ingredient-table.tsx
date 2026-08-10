'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

interface Ingredient {
  slug: string;
  name: string;
  functions: string[];
}

const INITIAL_COUNT = 5;

export function IngredientTable({ ingredients, count }: { ingredients: Ingredient[]; count: number }) {
  const [expanded, setExpanded] = useState(false);

  const isLimited = ingredients.length > INITIAL_COUNT;
  const displayed = expanded ? ingredients : ingredients.slice(0, INITIAL_COUNT);

  if (ingredients.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No ingredient panel on file for this product.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Ingredient</th>
              <th className="px-3 py-2 font-medium">Function</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {displayed.map((ing, i) => (
              <tr key={`${ing.slug}-${i}`}>
                <td className="px-3 py-2">{ing.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {ing.functions.length ? ing.functions.join(', ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLimited && (
        <button
          onClick={() => setExpanded(!expanded)}
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
          })}
        >
          {expanded ? 'Show less' : `Show all (${count})`}
          <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    </div>
  );
}
