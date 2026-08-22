import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useState } from "react";
import { FloatingSelect } from "../components/FloatingSelect";
import type { View } from "../domain";
import { getFeedbackTransition } from "../motion";

interface PatrolPageProps {
  contacted: boolean;
  reported: boolean;
  reportOpen: boolean;
  onReportOpenChange: (open: boolean) => void;
  onSubmitReport: () => void;
  onNavigate: (view: View) => void;
}

const REPORT_TYPE_OPTIONS = [
  { value: "Access blocked", label: "Access blocked" },
  { value: "Household status", label: "Household status" },
  { value: "Support required", label: "Support required" },
] as const;

function getTaskStatus(contacted: boolean, reported: boolean): string {
  if (reported) return "Report submitted";
  if (contacted) return "Priority assigned";
  return "Unassigned";
}

export function PatrolPage({
  contacted,
  reported,
  reportOpen,
  onReportOpenChange,
  onSubmitReport,
  onNavigate,
}: PatrolPageProps) {
  const reduceMotion = useReducedMotion();
  const [reportType, setReportType] = useState("Access blocked");
  const taskStatus = getTaskStatus(contacted, reported);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmitReport();
  };

  return (
    <section className="view workflow-view" aria-labelledby="patrol-title">
      <div className="workflow-heading floating-surface surface-soft">
        <div>
          <p className="breadcrumb">Field handoff</p>
          <h1 id="patrol-title">Field tasks</h1>
          <p>Verify unreachable households and access constraints on site.</p>
        </div>
        <a className="button secondary" href="/mobile/#patrol">
          Open field view
        </a>
      </div>
      <section className="task-workspace floating-surface surface-strong">
        <div className="task-queue">
          <div className="lens-heading">
            <div>
              <h2>Task queue</h2>
              <p>Highest priority first</p>
            </div>
          </div>
          <div className="task-row selected">
            <span>
              <strong>Check unreachable households</strong>
              <small>Field team 2 · Sangchon · 2 households</small>
            </span>
            <b>{taskStatus}</b>
          </div>
          <div className="task-row">
            <span>
              <strong>Verify County Road 12 closure</strong>
              <small>Road team 1</small>
            </span>
            <b>In review</b>
          </div>
        </div>
        <div className="task-detail">
          <span className="detail-label">Selected task</span>
          <h2>Check unreachable households</h2>
          <p>
            Verify two households, evacuation status, and any transport or
            medical support needs.
          </p>
          <dl>
            <div>
              <dt>Location</dt>
              <dd>Sangchon 214-3 area</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>Field team 2</dd>
            </div>
            <div>
              <dt>Complete when</dt>
              <dd>Both household states are reported</dd>
            </div>
          </dl>
          <button
            className="button primary"
            type="button"
            disabled={reported}
            onClick={() => onReportOpenChange(true)}
          >
            {reported ? "Report submitted" : "Add field report"}
          </button>
        </div>
      </section>

      <AnimatePresence>
        {reportOpen && (
          <motion.section
            className="report-lens floating-surface surface-strong"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={getFeedbackTransition(reduceMotion)}
          >
            <div className="lens-heading">
              <div>
                <h2>Field report</h2>
                <p>Access changes trigger route review and plan reapproval.</p>
              </div>
              <button
                className="button text"
                type="button"
                onClick={() => onReportOpenChange(false)}
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <FloatingSelect
                label="Report type"
                value={reportType}
                options={REPORT_TYPE_OPTIONS}
                onValueChange={setReportType}
              />
              <label>
                Location
                <input defaultValue="Sangchon access junction" required />
              </label>
              <label className="full">
                Field notes
                <textarea
                  defaultValue="Debris blocks vehicle access at the junction."
                  required
                />
              </label>
              <button className="button primary" type="submit">
                Submit report
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
      {reported && (
        <div
          className="workflow-feedback critical floating-surface"
          role="alert"
        >
          <span>
            The Sangchon access report changed the route to the north bypass.
          </span>
          <button
            className="button primary"
            type="button"
            onClick={() => onNavigate("plan")}
          >
            Review revised plan
          </button>
        </div>
      )}
    </section>
  );
}
