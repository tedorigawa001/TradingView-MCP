export const DXY_CONTEXT_GATE_NAME = "Bushido DXY Context Gate v1";
export const DXY_CONTEXT_GATE_VERSION = "1.0";
export const DXY_CONTEXT_GATE_RETURN_PLOT = "dxy_return_20";
export const DXY_CONTEXT_GATE_PLOT = "dxy_gate";

export const DXY_CONTEXT_GATE_SOURCE = `//@version=6
indicator("Bushido DXY Context Gate v1", overlay=false)

dxyReturn20 = request.security("TVC:DXY", "D", barstate.isconfirmed ? close / close[20] - 1.0 : na, gaps=barmerge.gaps_on, lookahead=barmerge.lookahead_off)
dxyGate = not barstate.isconfirmed or na(dxyReturn20) ? na : dxyReturn20 >= 0 ? 1.0 : 0.0

plot(dxyReturn20, "dxy_return_20", color=color.blue)
plot(dxyGate, "dxy_gate", color=color.green, style=plot.style_stepline)
`;
