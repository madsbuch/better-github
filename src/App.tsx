import { RouterProvider } from "@tanstack/react-router";
import { useSessionApi } from "./lib/session";
import { router } from "./router";
import { LoginScreen } from "./screens/LoginScreen";

export function App() {
  const { state } = useSessionApi();
  if (state.status === "signed-out") {
    return (
      <div className="app">
        <div className="content">
          <LoginScreen />
        </div>
      </div>
    );
  }
  // Routes (src/routes) only load once signed in, so loaders never run without a token.
  return <RouterProvider router={router} />;
}
