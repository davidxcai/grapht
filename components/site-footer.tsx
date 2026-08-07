export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-4xl px-5 py-6 text-sm text-muted-foreground">
        © {new Date().getFullYear()} David Cai
      </div>
    </footer>
  );
}
