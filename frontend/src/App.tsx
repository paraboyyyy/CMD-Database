import { Suspense, lazy } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { API_DOCS_URL } from "./api";
import SearchPage from "./pages/SearchPage";

// Pages with the 3D viewer pull in three.js, so load them on demand.
const MaterialPage = lazy(() => import("./pages/MaterialPage"));
const ViewerPage = lazy(() => import("./pages/ViewerPage"));

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          CMD Database
        </Link>
        <nav>
          <NavLink to="/" end>
            Materials
          </NavLink>
          <NavLink to="/viewer">Viewer</NavLink>
          <a href={API_DOCS_URL} target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
      </header>
      <main>
        <Suspense fallback={<div className="page muted">Loading…</div>}>
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/materials/:id" element={<MaterialPage />} />
            <Route path="/viewer" element={<ViewerPage />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <h1>Page not found</h1>
                  <Link to="/">Back to search</Link>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}
