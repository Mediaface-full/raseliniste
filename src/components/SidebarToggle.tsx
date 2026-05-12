import { useEffect, useState } from "react";
import { Menu, PanelLeftClose, PanelLeft, X } from "lucide-react";
import { Button } from "./ui/Button";

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Toggle sidebaru.
 *
 * **Mobil (<lg):** off-canvas overlay s backdropem (otevírá hamburgerem,
 * zavírá kliknutím mimo / Escape).
 *
 * **Desktop (≥lg):** squeeze — sidebar se schová do levé strany, hlavní
 * obsah zabere celou šířku. Stav persistuje v localStorage (`sidebar-collapsed`).
 */
export default function SidebarToggle() {
  // Mobile off-canvas state (default closed)
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapsed state — hydratováno z localStorage v useEffect
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  // Inicializace z localStorage po mountu (avoid SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setDesktopCollapsed(true);
    } catch {
      // private mode etc.
    }
  }, []);

  // Synchronizuj DOM atributy (Tailwind selectory v Shell.astro reagují)
  useEffect(() => {
    const root = document.documentElement;
    const sidebar = document.querySelector("[data-sidebar]");
    const backdrop = document.querySelector("[data-sidebar-backdrop]");
    const shell = document.querySelector("[data-shell]");

    // Mobile open/close
    if (mobileOpen) {
      root.classList.add("sidebar-open");
      sidebar?.setAttribute("data-open", "");
      backdrop?.setAttribute("data-open", "");
      document.body.style.overflow = "hidden";
    } else {
      root.classList.remove("sidebar-open");
      sidebar?.removeAttribute("data-open");
      backdrop?.removeAttribute("data-open");
      document.body.style.overflow = "";
    }

    // Desktop collapsed
    if (desktopCollapsed) {
      shell?.setAttribute("data-sidebar-collapsed", "true");
      sidebar?.setAttribute("data-collapsed", "true");
    } else {
      shell?.removeAttribute("data-sidebar-collapsed");
      sidebar?.removeAttribute("data-collapsed");
    }
  }, [mobileOpen, desktopCollapsed]);

  // Persist desktop state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(desktopCollapsed));
    } catch {
      // private mode
    }
  }, [desktopCollapsed]);

  // Click outside / Escape — jen pro mobile overlay
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-sidebar]") || target.closest("[data-sidebar-toggle]")) return;
      setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClickOutside);
    };
  }, [mobileOpen]);

  // Klávesová zkratka Cmd+\ / Ctrl+\ — toggle desktop collapse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        // Detekce desktopu — tlačítko se na desktopu chová jako collapse
        if (window.matchMedia("(min-width: 1024px)").matches) {
          setDesktopCollapsed((v) => !v);
        } else {
          setMobileOpen((v) => !v);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function handleClick() {
    // Na desktopu toggle collapse, na mobilu off-canvas
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label={
        mobileOpen
          ? "Zavřít menu"
          : desktopCollapsed
            ? "Otevřít boční panel"
            : "Skrýt boční panel"
      }
      title={
        mobileOpen
          ? "Zavřít menu"
          : desktopCollapsed
            ? "Otevřít boční panel (⌘\\)"
            : "Skrýt boční panel (⌘\\)"
      }
      data-sidebar-toggle
    >
      {/* Mobil: hamburger / X (close) */}
      <span className="lg:hidden">{mobileOpen ? <X /> : <Menu />}</span>
      {/* Desktop: panel-left / panel-left-close */}
      <span className="hidden lg:inline-flex">
        {desktopCollapsed ? <PanelLeft /> : <PanelLeftClose />}
      </span>
    </Button>
  );
}
