// How ORBIS works: the coupling, the three states, placeholders, data and limits.
import parity from '../../reference/parity_report.json';
import { POLIS, TEMPEST } from '../data';
import { ECON_SCALE, L4, OIL_PRODUCERS } from '../engine/politics';
import { quarterLabels } from '../engine/run';

const selectList = () => {
  const L = quarterLabels(TEMPEST.meta.start_quarter, 10);
  return Object.entries(POLIS.pool.countries).map(([iso, c]) => `${iso} after ${L[c.t_select as number]}`).join(', ');
};

export function MethodView() {
  const labels = quarterLabels(TEMPEST.meta.start_quarter, 4);
  return (
    <div className="view method">
      <section className="panel prose">
        <h2>How ORBIS joins TEMPEST and POLIS</h2>
        <p>
          ORBIS runs two of your models as one world. <b>TEMPEST</b> simulates 17 linked economies quarter by quarter, with crises that start,
          last and spread. <b>POLIS</b> simulates who holds power and how markets price it. Each Monte Carlo path in ORBIS is one coherent
          world: an economy and a politics that respond to each other. The full guide, with every coefficient and limitation, is{' '}
          <a href="https://github.com/auxt/ORBIS/blob/main/GUIDE.md" target="_blank" rel="noreferrer">GUIDE.md on GitHub</a>.
        </p>
        <Diagram />
        <ol className="steps">
          <li><b>Economy first.</b> TEMPEST runs from {labels[1]} on the {TEMPEST.meta.start_quarter} data vintage.</li>
          <li><b>Politics follows the economy.</b> Just before each country’s decisive event ({selectList()}), each path takes its world output gap so far, standardised on the baseline, and picks the closest of {POLIS.meta.pool.toLocaleString('en-GB')} political worlds from POLIS’s own Monte Carlo (one of the six nearest on the economy factor and the anti-incumbent swing, which all countries on a path share). In the baseline this reproduces POLIS’s probabilities. In a scenario, every {ECON_SCALE} pp of extra world output gap counts as one standard deviation of POLIS’s economy factor.</li>
          <li><b>Politics moves markets and policy.</b> The chosen world’s policy shift (fiscal stance, populism, illiberalism), uncertainty, irregular exits and policy events are priced with POLIS Layer 4 coefficients and each country’s vulnerability. They enter TEMPEST as a sovereign premium, an exchange-rate move, a confidence drag on demand, inflation and a change in the structural primary balance. Fiscal loosening works through TEMPEST’s own fiscal block, so it is not counted twice.</li>
          <li><b>Instability everywhere else.</b> POLIS Layer 1 scores 179 countries. For the nine ORBIS economies without a POLIS state vector, an acute event is an irregular-exit shock. For {OIL_PRODUCERS.length} oil producers (Energy Institute shares of world output), it removes supply and lifts TEMPEST’s oil price gap.</li>
        </ol>
        <h3>Three runs on the same random numbers</h3>
        <p>
          Every run simulates <b>A</b>, the baseline; <b>B</b>, the scenario; and <b>C</b>, the scenario with politics frozen at the baseline’s
          political worlds. All three share the same shocks, starting noise, parameter draws and political draws, so differences are effects,
          not noise. <b>B − A</b> is the scenario’s impact; <b>B − C</b> is how much the economy-to-politics feedback adds.
        </p>
      </section>

      <div className="grid2">
        <section className="panel prose">
          <h3>Assumptions ORBIS adds (placeholders)</h3>
          <table className="tbl compact">
            <tbody>
              <tr><th scope="row">Economy factor scale</th><td className="num">{ECON_SCALE} pp of world output gap per σ</td></tr>
              <tr><th scope="row">Political worlds chosen</th><td className="num">the quarter before each country’s first scheduled event; mid-2027 if none</td></tr>
              <tr><th scope="row">Fiscal stance to primary balance</th><td className="num">{L4.FISCAL_PB} pp of GDP per unit</td></tr>
              <tr><th scope="row">Uncertainty and event effects</th><td className="num">phase in over 2 quarters, half-life 6</td></tr>
              <tr><th scope="row">Policy shifts</th><td className="num">permanent from the change of government</td></tr>
              <tr><th scope="row">Producer supply loss</th><td className="num">25% of output, half-life 3 quarters</td></tr>
              <tr><th scope="row">Oil price per 1% of supply lost</th><td className="num">+8% (elasticity ≈ 0.125)</td></tr>
              <tr><th scope="row">Slovakia’s debt tolerance, NFA fallback</th><td className="num">80% / −60% of GDP</td></tr>
            </tbody>
          </table>
          <p className="dim">TEMPEST’s own behavioural parameters and POLIS’s hazards and Layer 4 coefficients are calibrated priors too. Every one can be moved in Assumptions.</p>
        </section>
        <section className="panel prose">
          <h3>Fidelity and data</h3>
          <p>
            <b>TEMPEST port:</b> {parity.passed} of {parity.total} statistics (world growth fans, global stress, crisis shares, GDP effects,
            country recession, crisis and debt figures, four library scenarios) match the Python model within Monte Carlo tolerance at {parity.paths.toLocaleString('en-GB')} paths.
          </p>
          <p><b>POLIS export:</b> a fresh 10,000-path run reproduces the published turnover probabilities of 4 November 2026 exactly.</p>
          <p>
            <b>Data:</b> BIS, IMF (WEO, IMTS, FSI, IIP) and FRED for the economies, vintage {TEMPEST.meta.exported.slice(0, 10)}; V-Dem, World Bank, UCDP/PRIO,
            Powell–Thyne and CHES for POLIS Layer 1; researched state vectors for eight countries (3–4 November 2026); Energy Institute
            Statistical Review 2025 for oil shares; Natural Earth for the map.
          </p>
          <h3>Limits</h3>
          <ul>
            <li>Political worlds respond to the world economy, not yet to each country’s own economy. Events before a country’s selection quarter take effect from the quarter after it.</li>
            <li>POLIS’s horizon ends in November 2028; later political change is not modelled.</li>
            <li>Results illustrate mechanisms under stated assumptions. They are not forecasts, ratings or advice.</li>
          </ul>
        </section>
      </div>
      <section className="panel prose">
        <h3>Disclaimer</h3>
        <p className="dim">
          Research prototype. Probabilities of crises, government change or election outcomes are model outputs under stated assumptions; they
          are not assessments of any government, party, candidate, institution or person, and express no preference among them. Nothing here is
          investment, financial, legal or policy advice. Built on <a href="https://github.com/auxt/TEMPEST" target="_blank" rel="noreferrer">TEMPEST</a> and{' '}
          <a href="https://github.com/auxt/POLIS" target="_blank" rel="noreferrer">POLIS</a> by Robert Auxt, with substantial assistance from Claude (Anthropic).
        </p>
      </section>
    </div>
  );
}

function Diagram() {
  return (
    <div className="diagram-wrap">
      <svg viewBox="0 0 760 270" className="diagram" role="img" aria-label="Diagram: POLIS layers and TEMPEST blocks exchange the economy, political worlds and instability shocks">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" className="dg-arrowhead" />
          </marker>
        </defs>
        <rect x="10" y="20" width="250" height="230" rx="10" className="dg-box" />
        <text x="26" y="46" className="dg-title">POLIS</text>
        <text x="26" y="64" className="dg-sub">politics, monthly to Nov 2028</text>
        {[['Layer 1', 'acute instability, 179 countries', 92], ['Layer 3', 'turnover Monte Carlo, 8 countries', 146], ['Layer 4', 'policy shift → market impact', 200]].map(([a, b, y]) => (
          <g key={a as string}>
            <rect x="26" y={(y as number) - 18} width="218" height="40" rx="6" className="dg-inner" />
            <text x="38" y={(y as number) - 1} className="dg-lbl">{a}</text>
            <text x="38" y={(y as number) + 14} className="dg-sub">{b}</text>
          </g>
        ))}
        <rect x="500" y="20" width="250" height="230" rx="10" className="dg-box" />
        <text x="516" y="46" className="dg-title">TEMPEST</text>
        <text x="516" y="64" className="dg-sub">17 economies, quarterly, 10 years</text>
        {[['Global factors', 'stress G, oil price gap', 92], ['Real economy · prices · policy', 'IS, Phillips, Taylor rule, FX', 146], ['Banks · fiscal · regimes', 'credit losses, debt, crisis odds', 200]].map(([a, b, y]) => (
          <g key={a as string}>
            <rect x="516" y={(y as number) - 18} width="218" height="40" rx="6" className="dg-inner" />
            <text x="528" y={(y as number) - 1} className="dg-lbl">{a}</text>
            <text x="528" y={(y as number) + 14} className="dg-sub">{b}</text>
          </g>
        ))}
        <path d="M244,92 C380,92 380,92 516,92" className="dg-arrow" markerEnd="url(#arr)" />
        <text x="380" y="84" textAnchor="middle" className="dg-edge">oil supply losses</text>
        <path d="M516,140 C380,140 380,140 244,140" className="dg-arrow" markerEnd="url(#arr)" />
        <text x="380" y="132" textAnchor="middle" className="dg-edge">world output gap → political world</text>
        <path d="M244,200 C380,200 380,200 516,200" className="dg-arrow" markerEnd="url(#arr)" />
        <text x="380" y="192" textAnchor="middle" className="dg-edge">premium, FX, demand, inflation, fiscal</text>
        <path d="M244,104 C330,104 400,180 516,190" className="dg-arrow faint" markerEnd="url(#arr)" />
        <text x="372" y="236" textAnchor="middle" className="dg-sub">irregular exits in 9 more economies</text>
      </svg>
    </div>
  );
}
