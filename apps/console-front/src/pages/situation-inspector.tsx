import type { Community, CommunityName, View } from "../domain";

interface SituationInspectorProps {
  readonly community: Community;
  readonly hidden: boolean;
  readonly reported: boolean;
  readonly onSelectCommunity: (name: CommunityName) => void;
  readonly onNavigate: (view: View) => void;
}

export function SituationInspector({
  community,
  hidden,
  reported,
  onSelectCommunity,
  onNavigate,
}: SituationInspectorProps) {
  return (
    <aside
      className="object-inspector"
      aria-live="polite"
      aria-label="Selected community details"
      aria-hidden={hidden}
      inert={hidden}
    >
      <div className="inspector-heading">
        <span>Selected community</span>
        <strong>{community.name}</strong>
        <small>{community.status}</small>
      </div>
      <dl className="inspector-data">
        <div>
          <dt>Residents</dt>
          <dd>{community.residents}</dd>
        </div>
        <div>
          <dt>Primary hazard</dt>
          <dd>{community.hazard}</dd>
        </div>
        <div>
          <dt>Support needs</dt>
          <dd>{community.support}</dd>
        </div>
        <div>
          <dt>Assigned shelter</dt>
          <dd>{community.shelter}</dd>
        </div>
        <div>
          <dt>Transport</dt>
          <dd>{community.transport}</dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            {reported && community.name === "Sangchon"
              ? "14:18 · field report"
              : community.update}
          </dd>
        </div>
      </dl>
      <div className="inspector-note">
        <span>Decision basis</span>
        <p>
          {reported && community.name === "Sangchon"
            ? "A new closure blocks the eastern approach. Use the north bypass and review the plan again."
            : community.note}
        </p>
      </div>
      <button
        className="button primary inspector-action"
        type="button"
        onClick={() => onNavigate("plan")}
      >
        Review assignment
      </button>
      <button
        className="button secondary inspector-action"
        type="button"
        onClick={() => onSelectCommunity(community.name)}
      >
        Center on map
      </button>
    </aside>
  );
}
