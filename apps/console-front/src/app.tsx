import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AssistantDrawer } from "./components/AssistantDrawer";
import {
  type CommunityName,
  communities,
  DEFAULT_MAP_SCENARIO,
  DEFAULT_RAINFALL_MM_PER_HOUR,
  navItems,
  type View,
} from "./domain";
import { getPressTransition } from "./motion";
import { ContactPage } from "./pages/contact-page";
import { PatrolPage } from "./pages/patrol-page";
import { PlanPage } from "./pages/plan-page";
import { SituationPage } from "./pages/situation-page";
import { useMapBridge } from "./use-map-bridge";

const MotionNavLink = motion.create(NavLink);

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [selectedCommunity, setSelectedCommunity] =
    useState<CommunityName>("Sangchon");
  const [approved, setApproved] = useState(false);
  const [contacted, setContacted] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const map = useMapBridge();
  const currentView =
    navItems.find((item) => item.path === location.pathname)?.view ??
    "situation";

  const handleNavigate = (nextView: View) => {
    const destination = navItems.find((item) => item.view === nextView);
    if (!destination) return;
    navigate(destination.path);
  };

  const handleSelectCommunity = (name: CommunityName) => {
    setSelectedCommunity(name);
    const community = communities.find((item) => item.name === name);
    if (community) {
      map.send({
        type: "map:set-camera",
        payload: { center: community.mapPoint, distanceMeters: 94_000 },
      });
    }
  };

  const handleStartContact = () => {
    if (!approved) {
      handleNavigate("plan");
      return;
    }
    setContacted(true);
  };

  const handleSubmitReport = () => {
    setReported(true);
    setApproved(false);
    setReportOpen(false);
    map.send({
      type: "map:set-scenario",
      payload: { scenario: DEFAULT_MAP_SCENARIO, rainfallMmPerHour: 86 },
    });
    map.send({ type: "map:set-overlay", payload: { enabled: true } });
  };

  const handleReset = () => {
    setApproved(false);
    setContacted(false);
    setReported(false);
    setReportOpen(false);
    setSelectedCommunity("Sangchon");
    handleNavigate("situation");
    map.send({ type: "map:sim-control", payload: { action: "reset" } });
    map.send({ type: "map:set-overlay", payload: { enabled: true } });
    map.send({
      type: "map:set-scenario",
      payload: {
        scenario: DEFAULT_MAP_SCENARIO,
        rainfallMmPerHour: DEFAULT_RAINFALL_MM_PER_HOUR,
      },
    });
  };

  const handleMapCommand = (command: DashboardCommand) => map.send(command);
  const contextHidden = currentView === "situation" && assistantOpen;

  return (
    <div
      className={`app-shell view-${currentView}${assistantOpen ? " is-assistant-open" : ""}`}
    >
      <div className="map-canvas">
        <iframe
          ref={map.frame.ref}
          src={map.frame.src}
          title="SALGIL 3D multi-hazard map"
          allow="fullscreen"
        />
        {map.status.connection !== "ready" && (
          <div
            className="map-feedback"
            role={map.status.connection === "error" ? "alert" : "status"}
          >
            <strong>
              {map.status.connection === "loading"
                ? "Loading operational map"
                : "3D map unavailable"}
            </strong>
            <span>
              {map.status.errorMessage ||
                "Operational controls remain available while the renderer reconnects."}
            </span>
          </div>
        )}
      </div>
      <aside className="side-nav">
        <MotionNavLink
          className="brand"
          to="/situation"
          whileTap={reduceMotion ? {} : { scale: 0.975 }}
          transition={getPressTransition(reduceMotion)}
          aria-label="SALGIL operations home"
        >
          <span className="brand-lockup">
            <img src="/salgil-mark.svg" alt="" />
            <strong>Salgil</strong>
          </span>
          <small>Evacuation operations</small>
        </MotionNavLink>
        <nav aria-label="Main views">
          {navItems.map((item) => (
            <MotionNavLink
              key={item.view}
              className="nav-item"
              to={item.path}
              whileTap={reduceMotion ? {} : { scale: 0.975 }}
              transition={getPressTransition(reduceMotion)}
            >
              <span className="nav-label-full">{item.label}</span>
              <span className="nav-label-short">{item.shortLabel}</span>
            </MotionNavLink>
          ))}
        </nav>
        <div className="side-footer">
          <span>Exercise mode</span>
          <p>Cheongsong multi-hazard response</p>
          <a href="/mobile/">Open field view</a>
        </div>
      </aside>

      <div className="workspace">
        <header
          className="context-bar"
          aria-hidden={contextHidden}
          inert={contextHidden}
        >
          <div className="context-title">
            <strong>Cheongsong Emergency Operations Center</strong>
            <span>Updated Aug 22, 2026 at 14:10</span>
          </div>
          <div className="context-actions">
            <motion.button
              className="button secondary"
              type="button"
              onClick={handleReset}
              whileTap={reduceMotion ? {} : { scale: 0.975 }}
              transition={getPressTransition(reduceMotion)}
            >
              Reset exercise
            </motion.button>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={location.pathname}
            className={`route-main route-${currentView}`}
            id="main-content"
            tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? {} : { opacity: 0, y: -2 }}
            transition={{ duration: reduceMotion ? 0 : 0.13, ease: "easeOut" }}
          >
            <Routes location={location}>
              <Route
                path="/situation"
                element={
                  <SituationPage
                    assistantOpen={assistantOpen}
                    map={map}
                    selectedCommunity={selectedCommunity}
                    reported={reported}
                    onSelectCommunity={handleSelectCommunity}
                    onNavigate={handleNavigate}
                    onMapCommand={handleMapCommand}
                  />
                }
              />
              <Route
                path="/evacuation-plan"
                element={
                  <PlanPage
                    approved={approved}
                    reported={reported}
                    onApprove={() => setApproved(true)}
                    onNavigate={handleNavigate}
                  />
                }
              />
              <Route
                path="/contact-status"
                element={
                  <ContactPage
                    approved={approved}
                    contacted={contacted}
                    onStartContact={handleStartContact}
                    onNavigate={handleNavigate}
                  />
                }
              />
              <Route
                path="/field-tasks"
                element={
                  <PatrolPage
                    contacted={contacted}
                    reported={reported}
                    reportOpen={reportOpen}
                    onReportOpenChange={setReportOpen}
                    onSubmitReport={handleSubmitReport}
                    onNavigate={handleNavigate}
                  />
                }
              />
              <Route path="/" element={<Navigate to="/situation" replace />} />
              <Route path="*" element={<Navigate to="/situation" replace />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
      </div>
      <AssistantDrawer open={assistantOpen} onOpenChange={setAssistantOpen} />
    </div>
  );
}
