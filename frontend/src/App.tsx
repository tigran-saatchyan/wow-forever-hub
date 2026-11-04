import { AnimatePresence, motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useMe } from "./lib/auth";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Talents } from "./pages/Talents";

/** The whole hub is private for now: only the superadmin (and later guild members) can open it. */
function Private({ children }: { children: JSX.Element }) {
  const me = useMe();
  if (me.isLoading) return null;
  return me.data ? children : <Navigate to="/login" replace />;
}

export function App() {
  const loc = useLocation();
  return (
    <Layout>
      <AnimatePresence mode="wait">
        <motion.div
          key={loc.pathname}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ duration: 0.25 }}
        >
          <Routes location={loc}>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Private><Dashboard /></Private>} />
            <Route path="/talents" element={<Private><Talents /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}
