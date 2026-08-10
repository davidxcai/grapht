import Image from "next/image";
import { Package } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one product-photo box in the app. Always `object-contain` on white —
 * these are catalog listing shots (bottle, tube, jar) at whatever aspect
 * ratio the manufacturer used, and `cover` would crop off the cap or the
 * label. Box size, rounding, and border are the caller's concern via
 * `className`; this component only owns image-vs-fallback and the fit rule
 * everything drifted away from before (see CLAUDE.md, "Every product photo
 * renders through one shared primitive").
 *
 * Reuse this rather than another `<Image>`/`Package` pair. For a small
 * reference next to other content (nav search, `SearchCombobox`,
 * `RoutineSummary`, `TrialCard`), use it directly. For a full card, check
 * `ProductCard`, `ProductDraftCard`, and `CatalogProductCard` (all in
 * `components/`) before building a new one — one of them almost certainly
 * already fits.
 */
export function Thumbnail({
    src,
    alt = "",
    size,
    className,
}: {
    src?: string | null;
    alt?: string;
    size: number;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-white",
                className,
            )}
        >
            {src ? (
                <Image
                    src={src}
                    alt={alt}
                    width={size}
                    height={size}
                    unoptimized
                    className="size-full object-contain"
                />
            ) : (
                <Package
                    className="text-neutral-300"
                    size={Math.round(size * 0.3)}
                    aria-hidden
                />
            )}
        </div>
    );
}
