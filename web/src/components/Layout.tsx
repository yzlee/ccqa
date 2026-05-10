import { Link, NavLink, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-5 py-3 flex items-center gap-6">
          <Link to="/" className="font-semibold tracking-tight">
            CCQA
          </Link>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/projects"
              className={({ isActive }) =>
                isActive ? "text-white" : "text-zinc-400 hover:text-zinc-100"
              }
            >
              Projects
            </NavLink>
          </nav>
          <div className="ml-auto text-xs text-zinc-500">
            LLM-driven QA harness · read-only
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
