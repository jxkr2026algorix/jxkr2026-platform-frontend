import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { View } from "../domain";
import { getFeedbackTransition } from "../motion";

interface PlanPageProps {
  approved: boolean;
  reported: boolean;
  onApprove: () => void;
  onNavigate: (view: View) => void;
}

function getPlanStatus(approved: boolean, reported: boolean): string {
  if (approved) return "Approved";
  if (reported) return "Reapproval required";
  return "Awaiting approval";
}

function getApprovalLabel(approved: boolean, reported: boolean): string {
  if (approved) return "Approved";
  if (reported) return "Approve revised plan";
  return "Approve plan";
}

export function PlanPage({
  approved,
  reported,
  onApprove,
  onNavigate,
}: PlanPageProps) {
  const reduceMotion = useReducedMotion();
  const planStatus = getPlanStatus(approved, reported);
  const approvalLabel = getApprovalLabel(approved, reported);

  return (
    <section className="view workflow-view" aria-labelledby="plan-title">
      <div className="workflow-heading floating-surface surface-soft">
        <div>
          <p className="breadcrumb">Incident 2026-0822-01</p>
          <h1 id="plan-title">Review evacuation plan</h1>
          <p>
            Confirm the recommended order, transport, and shelter assignment
            before approval.
          </p>
        </div>
        <span className={`state-text ${approved ? "is-approved" : ""}`}>
          <i />
          {planStatus}
        </span>
      </div>
      <section className="workflow-body floating-surface surface-strong">
        <div className="lens-heading">
          <div>
            <h2>Community assignments</h2>
            <p>Draft based on exposure, transport, and access constraints.</p>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => onNavigate("situation")}
          >
            View situation
          </button>
        </div>
        <div className="table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Community</th>
                <th>Residents</th>
                <th>Shelter</th>
                <th>Transport</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>
                  <strong>Sangchon</strong>
                </td>
                <td>34</td>
                <td>Jinbo Sports Center</td>
                <td>
                  {reported ? "Bus 1 · north bypass" : "Bus 1 · ambulance"}
                </td>
                <td>
                  {reported
                    ? "Field access report"
                    : "Slope risk · mobility needs"}
                </td>
              </tr>
              <tr>
                <td>2</td>
                <td>
                  <strong>Wolwe</strong>
                </td>
                <td>27</td>
                <td>Jinbo Sports Center</td>
                <td>Bus 1</td>
                <td>Wildfire approach</td>
              </tr>
              <tr>
                <td>3</td>
                <td>
                  <strong>Bunam</strong>
                </td>
                <td>15</td>
                <td>Bunam Community Center</td>
                <td>Van</td>
                <td>Alternate access route</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="lens-action">
          <div>
            <strong>Approval enables contact with 76 residents.</strong>
            <span>Owner: Operations lead Jisoo Kim</span>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={approved}
            onClick={onApprove}
          >
            {approvalLabel}
          </button>
        </div>
      </section>
      <AnimatePresence>
        {approved && (
          <motion.div
            className="workflow-feedback floating-surface"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={getFeedbackTransition(reduceMotion)}
          >
            Plan approved at 14:12. Resident contact is ready.
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
