export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="page-width px-5 py-6 text-sm text-muted-foreground">
        © {new Date().getFullYear()} David Cai
      </div>
    </footer>
  );
}
