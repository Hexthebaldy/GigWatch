import { AppShell } from "./components/layout/AppShell";
import { StoreProvider } from "./store";

export const App = () => (
  <StoreProvider>
    <AppShell />
  </StoreProvider>
);
