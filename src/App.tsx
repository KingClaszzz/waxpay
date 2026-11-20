import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Landing from "./Landing";

const route = () => (window.location.hash.startsWith("#/app") ? "app" : "landing");

export default function App() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => {
      const next = route();
      setR((prev) => {
        if (prev !== next) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r === "app" ? <Dashboard /> : <Landing />;
}
