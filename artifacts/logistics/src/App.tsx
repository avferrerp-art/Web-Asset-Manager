import { useEffect, useRef } from "react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import PreDespacho from "@/pages/pre-despacho";
import Despachos from "@/pages/despachos";
import Ventas from "@/pages/ventas";
import Vehiculos from "@/pages/vehiculos";
import Personal from "@/pages/personal";
import Rutas from "@/pages/rutas";
import Carga from "@/pages/carga";
import Articulos from "@/pages/articulos";
import Configuracion from "@/pages/configuracion";

const queryClient = new QueryClient();

// REQUIRED — copied verbatim from the canonical setup. Resolves the key from
// window.location.hostname so the same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty in dev (Clerk hits dev FAPI directly), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(38 92% 50%)",
    colorForeground: "hsl(210 40% 98%)",
    colorMutedForeground: "hsl(215 20% 65%)",
    colorDanger: "hsl(0 72% 55%)",
    colorBackground: "hsl(224 45% 8%)",
    colorInput: "hsl(217 32% 17%)",
    colorInputForeground: "hsl(210 40% 98%)",
    colorNeutral: "hsl(210 40% 98%)",
    fontFamily: '"Inter", sans-serif',
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[hsl(224,45%,8%)] border border-[hsl(217,32%,17%)] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(210,40%,98%)]",
    headerSubtitle: "text-[hsl(215,20%,65%)]",
    socialButtonsBlockButtonText: "text-[hsl(210,40%,98%)]",
    formFieldLabel: "text-[hsl(210,40%,98%)]",
    footerActionLink: "text-[hsl(38,92%,50%)] hover:text-[hsl(38,92%,60%)]",
    footerActionText: "text-[hsl(215,20%,65%)]",
    dividerText: "text-[hsl(215,20%,65%)]",
    identityPreviewEditButton: "text-[hsl(38,92%,50%)]",
    formFieldSuccessText: "text-[hsl(150,60%,55%)]",
    alertText: "text-[hsl(210,40%,98%)]",
    logoBox: "justify-center",
    logoImage: "h-9",
    socialButtonsBlockButton: "bg-[hsl(217,32%,17%)] border border-[hsl(217,32%,25%)] hover:bg-[hsl(217,32%,22%)]",
    formButtonPrimary: "bg-[hsl(38,92%,50%)] text-[hsl(222,47%,11%)] hover:bg-[hsl(38,92%,58%)] font-semibold",
    formFieldInput: "bg-[hsl(217,32%,17%)] border-[hsl(217,32%,25%)] text-[hsl(210,40%,98%)]",
    footerAction: "justify-center",
    dividerLine: "bg-[hsl(217,32%,25%)]",
    alert: "bg-[hsl(217,32%,17%)]",
    otpCodeFieldInput: "bg-[hsl(217,32%,17%)] text-[hsl(210,40%,98%)] border-[hsl(217,32%,25%)]",
    formFieldRow: "gap-2",
    main: "gap-6",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 dark">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 dark">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ProtectedPage({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ProtectedNotFound() {
  return (
    <>
      <Show when="signed-in">
        <NotFound />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Helps the webview stay up-to-date when the signed-in user changes by
// invalidating the QueryClient cache.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <ProtectedPage component={Dashboard} />
      </Route>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/pre-despacho">
        <ProtectedPage component={PreDespacho} />
      </Route>
      <Route path="/despachos">
        <ProtectedPage component={Despachos} />
      </Route>
      <Route path="/ventas">
        <ProtectedPage component={Ventas} />
      </Route>
      <Route path="/vehiculos">
        <ProtectedPage component={Vehiculos} />
      </Route>
      <Route path="/personal">
        <ProtectedPage component={Personal} />
      </Route>
      <Route path="/rutas">
        <ProtectedPage component={Rutas} />
      </Route>
      <Route path="/carga">
        <ProtectedPage component={Carga} />
      </Route>
      <Route path="/articulos">
        <ProtectedPage component={Articulos} />
      </Route>
      <Route path="/configuracion">
        <ProtectedPage component={Configuracion} />
      </Route>
      <Route component={ProtectedNotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Bienvenido de nuevo",
            subtitle: "Inicia sesión para acceder a LogiFleet",
          },
        },
        signUp: {
          start: {
            title: "Crea tu cuenta",
            subtitle: "Acceso al sistema logístico de Netso",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
