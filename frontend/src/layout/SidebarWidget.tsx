export default function SidebarWidget() {
  return (
    <div
      className={`
        mx-auto mb-10 w-full max-w-60 rounded-2xl bg-overlay-xs px-4 py-5 text-center`}
    >
      <h3 className="mb-2 font-semibold text-primary">
        #1 Tailwind CSS Dashboard
      </h3>
      <p className="mb-4 text-muted text-theme-sm">
        Leading Tailwind CSS Admin Template with 400+ UI Component and Pages.
      </p>
      <a
        href="https://tailadmin.com/pricing"
        target="_blank"
        rel="nofollow"
        className="flex items-center justify-center p-3 font-medium text-[var(--accent)] rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] border border-[rgb(var(--accent-rgb)/0.30)] text-theme-sm hover:bg-[rgb(var(--accent-rgb)/0.18)]"
      >
        Purchase Plan
      </a>
    </div>
  );
}
