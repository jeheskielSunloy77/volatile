import * as React from "react";

import { LogoLoader } from "@/renderer/components/logos";

const MINIMUM_SPLASH_DURATION_MS = 2500;

let hasCompletedStartupForRendererLifetime = false;

type StartupGateContextValue = {
  isStartupComplete: boolean;
  setRegistration: (id: string, isReady: boolean) => void;
  clearRegistration: (id: string) => void;
};

const StartupGateContext = React.createContext<StartupGateContextValue | null>(
  null,
);

export const StartupGateProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const mountedAtRef = React.useRef(Date.now());
  const completionTimeoutRef = React.useRef<number | null>(null);
  const isCompletionScheduledRef = React.useRef(false);
  const [isStartupComplete, setIsStartupComplete] = React.useState(
    () => hasCompletedStartupForRendererLifetime,
  );
  const [registrations, setRegistrations] = React.useState<
    Record<string, boolean>
  >({});

  const completeStartup = React.useCallback(() => {
    if (hasCompletedStartupForRendererLifetime) {
      setIsStartupComplete(true);
      return;
    }

    if (isCompletionScheduledRef.current) {
      return;
    }

    isCompletionScheduledRef.current = true;
    const elapsedMs = Date.now() - mountedAtRef.current;
    const delayMs = Math.max(0, MINIMUM_SPLASH_DURATION_MS - elapsedMs);
    const finalizeStartup = () => {
      hasCompletedStartupForRendererLifetime = true;
      isCompletionScheduledRef.current = false;
      completionTimeoutRef.current = null;
      React.startTransition(() => {
        setIsStartupComplete(true);
      });
    };

    if (delayMs === 0) {
      finalizeStartup();
      return;
    }

    completionTimeoutRef.current = window.setTimeout(finalizeStartup, delayMs);
  }, []);

  React.useEffect(() => {
    return () => {
      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  const setRegistration = React.useCallback((id: string, isReady: boolean) => {
    setRegistrations((current) => {
      if (current[id] === isReady) {
        return current;
      }

      return {
        ...current,
        [id]: isReady,
      };
    });
  }, []);

  const clearRegistration = React.useCallback((id: string) => {
    setRegistrations((current) => {
      if (!(id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (isStartupComplete) {
      return;
    }

    const states = Object.values(registrations);
    if (states.length === 0 || states.some((state) => !state)) {
      return;
    }

    completeStartup();
  }, [completeStartup, isStartupComplete, registrations]);

  const value = React.useMemo(
    () => ({
      isStartupComplete,
      setRegistration,
      clearRegistration,
    }),
    [clearRegistration, isStartupComplete, setRegistration],
  );

  return (
    <StartupGateContext.Provider value={value}>
      {children}
      {isStartupComplete ? null : (
        <div className="bg-background fixed inset-0 z-[100] grid place-items-center">
          <LogoLoader className="size-20 text-foreground" />
        </div>
      )}
    </StartupGateContext.Provider>
  );
};

export const useStartupGateReady = (id: string, isReady: boolean) => {
  const context = React.useContext(StartupGateContext);

  if (!context) {
    throw new Error(
      "useStartupGateReady must be used within StartupGateProvider.",
    );
  }

  React.useLayoutEffect(() => {
    if (context.isStartupComplete) {
      return;
    }

    context.setRegistration(id, isReady);

    return () => {
      context.clearRegistration(id);
    };
  }, [context, id, isReady]);
};
