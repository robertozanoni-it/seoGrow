import { useEffect, useState } from "react";
import RemediationHost from "./RemediationHost";
import WordPressConnectionControl from "./WordPressConnectionControl";
import WordPressLiveRemediationControlV2 from "./WordPressLiveRemediationControlV2";
import WordPressTaxonomyRemediationControl from "./WordPressTaxonomyRemediationControl";
import WordPressConnectorControl from "./WordPressConnectorControl";

const currentPage = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

export default function RemediationRuntime() {
  const [state, setState] = useState(() => ({ page: currentPage(), generation: 0 }));

  useEffect(() => {
    const refresh = () => setState((current) => ({
      page: currentPage(),
      generation: current.generation + 1,
    }));
    window.addEventListener("hashchange", refresh);
    window.addEventListener("seogrow-locationchange", refresh);
    return () => {
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("seogrow-locationchange", refresh);
    };
  }, []);

  if (state.page !== "Audit SEO") return null;
  const key = `remediation-runtime-${state.generation}`;
  return (
    <>
      <RemediationHost key={`${key}-host`} />
      <WordPressConnectionControl key={`${key}-connection`} />
      <WordPressLiveRemediationControlV2 key={`${key}-live`} />
      <WordPressTaxonomyRemediationControl key={`${key}-taxonomy`} />
      <WordPressConnectorControl key={`${key}-connector`} />
    </>
  );
}
