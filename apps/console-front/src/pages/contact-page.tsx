import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { View } from "../domain";
import { getFeedbackTransition } from "../motion";

interface ContactPageProps {
  approved: boolean;
  contacted: boolean;
  onStartContact: () => void;
  onNavigate: (view: View) => void;
}

const contactRows = [
  {
    community: "Sangchon",
    households: "12 households",
    channel: "Call · SMS",
    response: "Evacuating",
    followUp: "Moving to assembly point",
    resultClass: "is-evacuating",
  },
  {
    community: "Wolwe",
    households: "9 households",
    channel: "Call · SMS",
    response: "Support requested",
    followUp: "Vehicle assigned for 2 residents",
    resultClass: "is-support",
  },
  {
    community: "Bunam",
    households: "5 households",
    channel: "Call",
    response: "Unreachable",
    followUp: "Field team 2 verification required",
    resultClass: "is-unreachable",
  },
] as const;

function getContactStatus(approved: boolean, contacted: boolean): string {
  if (contacted) return "Contact complete";
  if (approved) return "Ready";
  return "Awaiting approval";
}

function getPendingContactCopy(approved: boolean): {
  response: string;
  followUp: string;
} {
  if (approved)
    return { response: "Ready", followUp: "Start resident contact" };
  return { response: "Queued", followUp: "Approve evacuation plan" };
}

export function ContactPage({
  approved,
  contacted,
  onStartContact,
  onNavigate,
}: ContactPageProps) {
  const reduceMotion = useReducedMotion();
  const contactStatus = getContactStatus(approved, contacted);
  const pendingContactCopy = getPendingContactCopy(approved);

  return (
    <section className="view workflow-view" aria-labelledby="contact-title">
      <div className="workflow-heading liquid-layer layer-soft">
        <div>
          <p className="breadcrumb">
            {approved ? "Approved plan" : "Plan approval required"}
          </p>
          <h1 id="contact-title">Resident contact status</h1>
          <p>
            Review automated responses and hand unreachable households to field
            teams.
          </p>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={onStartContact}
        >
          {contacted ? "Refresh results" : "Start contact"}
        </button>
      </div>
      <section
        className="metric-lens liquid-layer"
        aria-label="Contact result summary"
      >
        <div>
          <span>Total</span>
          <strong>76</strong>
        </div>
        <div>
          <span>Evacuating</span>
          <strong>{contacted ? 63 : 0}</strong>
        </div>
        <div>
          <span>Support requested</span>
          <strong>{contacted ? 11 : 0}</strong>
        </div>
        <div>
          <span>Unreachable</span>
          <strong>{contacted ? 2 : 0}</strong>
        </div>
      </section>
      <section className="workflow-body liquid-layer layer-strong">
        <div className="lens-heading">
          <div>
            <h2>Contact roster</h2>
            <p>Exercise responses appear after contact begins.</p>
          </div>
          <span className={`state-text ${approved ? "is-approved" : ""}`}>
            <i />
            {contactStatus}
          </span>
        </div>
        <div className="table-wrap">
          <table className="contact-table">
            <thead>
              <tr>
                <th>Community</th>
                <th>Households</th>
                <th>Channel</th>
                <th>Response</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {contactRows.map((row) => {
                const response = contacted
                  ? row.response
                  : pendingContactCopy.response;
                const followUp = contacted
                  ? row.followUp
                  : pendingContactCopy.followUp;
                return (
                  <tr key={row.community}>
                    <td>{row.community}</td>
                    <td>{row.households}</td>
                    <td>{row.channel}</td>
                    <td className={contacted ? row.resultClass : ""}>
                      {response}
                    </td>
                    <td>{followUp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <AnimatePresence>
        {contacted && (
          <motion.div
            className="workflow-feedback feedback-action liquid-layer"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={getFeedbackTransition(reduceMotion)}
          >
            <span>Two households are unreachable.</span>
            <button
              className="button secondary"
              type="button"
              onClick={() => onNavigate("patrol")}
            >
              Assign field verification
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
