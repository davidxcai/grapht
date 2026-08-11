import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HeroSearch } from "@/components/hero-search";
import { BrandMarquee } from "@/components/brand-marquee";
import { TrialCard } from "@/components/trial-card";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CardGrid } from "@/components/card-grid";
import { listRecentPublicTrials, listTrendingProducts } from "@/lib/community";
import { toCardData } from "@/lib/trials";

const HOME_SECTION_LIMIT = 4;

/**
 * The front door: search over the front of the page, every published trial
 * below it, ongoing and finished (ideas.md). Free to browse signed out —
 * watching someone else's trial run is the pitch for starting your own, so a
 * first-time visitor lands on the trials themselves rather than on a page
 * describing them.
 *
 * The search box never changes what renders here — it only navigates away,
 * to a product page or to /search (components/hero-search.tsx). Ordering is
 * recency.
 */
export const dynamic = "force-dynamic";

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
            {children}
        </p>
    );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
    return (
        <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Link
                href={href}
                className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
            >
                See all
                <ChevronRight className="size-4" aria-hidden />
            </Link>
        </div>
    );
}

export default async function Home() {
    const [ongoing, completed, trending] = await Promise.all([
        listRecentPublicTrials("active", HOME_SECTION_LIMIT),
        listRecentPublicTrials("completed", HOME_SECTION_LIMIT),
        listTrendingProducts(HOME_SECTION_LIMIT),
    ]);

    return (
        <main className="w-full px-5 py-10 lg:px-10">
            <section className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center sm:py-20">
                <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                    Skincare, Verified.
                </h1>
                <p className="mt-3 text-base text-muted-foreground text-balance sm:text-lg">
                    Search thousands of skincare products to see real-world
                    results.
                </p>
                <div className="mt-7 w-full">
                    <HeroSearch />
                </div>
            </section>

            <BrandMarquee />

            {trending.length > 0 && (
                <section className="mt-8">
                    <SectionHeader title="Trending products" href="/search?sortProducts=trending" />
                    <CardGrid className="mt-5">
                        {trending.map((product) => (
                            <CatalogProductCard
                                key={product.key}
                                product={{
                                    id: product.catalogProductId ?? product.key,
                                    brand: product.brand,
                                    name: product.name,
                                    image: product.image,
                                    concernTags: product.targets,
                                    userCount: product.users,
                                }}
                            />
                        ))}
                    </CardGrid>
                </section>
            )}

            <section className="mt-8">
                <SectionHeader title="Active user trials" href="/search?tab=trials&sortTrials=active" />
                {ongoing.length === 0 ? (
                    <div className="mt-5">
                        <Empty>Nothing to show</Empty>
                    </div>
                ) : (
                    <CardGrid className="mt-5">
                        {ongoing.map((entry) => (
                            <TrialCard
                                key={entry.trial.id}
                                data={toCardData(entry.trial)}
                                handle={entry.handle}
                            />
                        ))}
                    </CardGrid>
                )}
            </section>

            <section className="mt-8">
                <SectionHeader title="Completed user trials" href="/search?tab=trials&sortTrials=completed" />
                {completed.length === 0 ? (
                    <div className="mt-5">
                        <Empty>Nothing to show</Empty>
                    </div>
                ) : (
                    <CardGrid className="mt-5">
                        {completed.map((entry) => (
                            <TrialCard
                                key={entry.trial.id}
                                data={toCardData(entry.trial)}
                                handle={entry.handle}
                            />
                        ))}
                    </CardGrid>
                )}
            </section>
        </main>
    );
}
