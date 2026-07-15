"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type DashboardRuntimeBoundaryProps = {
  children: ReactNode;
  title?: string;
};

type DashboardRuntimeBoundaryState = {
  error: Error | null;
};

export class DashboardRuntimeBoundary extends Component<
  DashboardRuntimeBoundaryProps,
  DashboardRuntimeBoundaryState
> {
  state: DashboardRuntimeBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): DashboardRuntimeBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Dashboard runtime error", error, errorInfo);
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error) {
      return (
        <section className="rounded-[24px] border border-coral/30 bg-coral/10 px-4 py-5 text-ink">
          <p className="text-xs uppercase tracking-[0.24em] text-coral">
            {this.props.title ?? "Dashboard"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-ink">
            No se pudo renderizar este bloque
          </h2>
          <p className="mt-2 text-sm text-sand/90">
            {this.state.error.message || "Error inesperado en el dashboard."}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="secondary-button mt-4"
          >
            Recargar
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
