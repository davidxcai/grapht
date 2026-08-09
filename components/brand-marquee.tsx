import { Marquee } from '@/components/ui/marquee';

const BRANDS = [
  'La Roche-Posay',
  'CeraVe',
  'SkinCeuticals',
  "Paula's Choice",
  'Dermalogica',
  'Avène',
  'Obagi',
  'The Ordinary',
  'Sunday Riley',
  'Drunk Elephant',
  'Medik8',
  'The Inkey List',
  'Estée Lauder',
  'Lancôme',
  'Clinique',
  'Shiseido',
  "Kiehl's",
  'Clarins',
  'La Mer',
  'Augustinus Bader',
  'SK-II',
  'La Prairie',
  'Clé de Peau Beauté',
  'Biologique Recherche',
  'Sulwhasoo',
  'Laneige',
  'Tatcha',
  'COSRX',
  'Glow Recipe',
  'Rhode',
];

/**
 * Brand wall between the hero search and the trial sections. Purely
 * decorative social proof — no links, no data — so it renders on the server.
 */
export function BrandMarquee() {
  return (
    <div className="relative w-full overflow-hidden">
      <Marquee className="[--duration:90s] [--gap:2.5rem]">
        {BRANDS.map((brand) => (
          <span key={brand} className="flex items-center gap-10 whitespace-nowrap">
            <span className="text-sm font-medium text-muted-foreground sm:text-base">
              {brand}
            </span>
            <span className="text-muted-foreground/25" aria-hidden="true">
              &bull;
            </span>
          </span>
        ))}
      </Marquee>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent sm:w-24" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent sm:w-24" />
    </div>
  );
}
