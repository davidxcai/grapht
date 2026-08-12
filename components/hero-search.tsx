"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Thumbnail } from "@/components/thumbnail";
import { searchHeroProducts } from "@/app/search/actions";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import type { CatalogPickerMatch } from "@/lib/catalog";

/**
 * The homepage search. Debounces into a dropdown of matching catalog
 * products, picking one goes straight to that product's page. It never
 * touches the homepage's own trial feed (ideas.md) — this box only
 * navigates away, either to a product or, on enter/search with nothing
 * picked, to /search, which also covers trials and ingredients.
 */
export function HeroSearch() {
    const router = useRouter();
    const { trimmed, options, showOptions, setOpen, inputProps } =
        useDebouncedSearch<CatalogPickerMatch>(searchHeroProducts, 300);

    function goToSearchPage() {
        router.push(
            trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search",
        );
    }

    return (
        <div className="relative">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    goToSearchPage();
                }}
                className="w-full"
            >
                <InputGroup className="h-14 px-4">
                    <InputGroupAddon>
                        <button type="submit" aria-label="Search" className="shrink-0">
                            <SearchIcon className="size-6 text-foreground" aria-hidden />
                        </button>
                    </InputGroupAddon>
                    <InputGroupInput
                        {...inputProps}
                        placeholder="Search products, brands, ingredients…"
                        aria-label="Search"
                        className="text-base"
                    />
                </InputGroup>
            </form>

            {showOptions && (
                <ul className="absolute z-10 mt-1 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10">
                    {options.map((opt) => (
                        <li key={opt.id}>
                            <Link
                                href={`/products/${opt.id}`}
                                // Fires before the input's onBlur closes the list.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-slate-100/50"
                            >
                                <Thumbnail
                                    src={opt.image}
                                    size={32}
                                    className="size-8 rounded"
                                />
                                <span className="min-w-0 truncate">
                                    {opt.brand && (
                                        <span className="text-muted-foreground">
                                            {opt.brand}{" "}
                                        </span>
                                    )}
                                    {opt.name}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
