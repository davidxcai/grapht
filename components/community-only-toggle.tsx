"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Replaces the old standalone /products page: rather than a separate index
 * of only-ever-trialled products, it's a toggle on /search's Products tab
 * that restricts catalog results to products the community actually uses —
 * in a public trial or a public routine (`searchCatalog()`'s `productIds`
 * filter, sourced from `listCommunityProductIds()` in app/search/page.tsx).
 */
export function CommunityOnlyToggle({ active }: { active: boolean }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    function toggle(on: boolean) {
        const merged = new URLSearchParams(params.toString());
        merged.delete("page");
        if (on) merged.set("community", "1");
        else merged.delete("community");
        router.push(
            merged.size ? `${pathname}?${merged.toString()}` : pathname,
            { scroll: false },
        );
    }

    return (
        <div className="flex items-center gap-2">
            <Switch
                id="community-only"
                checked={active}
                onCheckedChange={toggle}
            />
            <Label
                htmlFor="community-only"
                className="text-sm font-normal text-muted-foreground"
            >
                Used by community
            </Label>
        </div>
    );
}
