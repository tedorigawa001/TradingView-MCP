export const COT_CROWDING_UNWIND_OVERLAY_NAME = "Bushido COT Crowd-Unwind Context";
export const COT_CROWDING_UNWIND_OVERLAY_VERSION = "1.0";

export const COT_CROWDING_UNWIND_OVERLAY_INPUTS = [
  { id: "in_0", name: "COT Percentile (3Y)" },
  { id: "in_1", name: "Target Net OI Ratio %" },
  { id: "in_2", name: "COT Report Date" },
  { id: "in_3", name: "COT Available At" },
  { id: "in_4", name: "Structure Lookback" },
  { id: "in_5", name: "Show Context Table" },
  { id: "in_6", name: "Volume Profile POC" },
  { id: "in_7", name: "Volume Profile VAH" },
  { id: "in_8", name: "Volume Profile VAL" },
  { id: "in_9", name: "Volume Profile Trading Day" },
  { id: "in_10", name: "Volume Profile Type" },
  { id: "in_11", name: "Direct COT Futures Currency" },
  { id: "in_12", name: "Direct COT Futures % / Percentile" },
] as const;

// COT data is intentionally supplied as explicit inputs. Pine cannot retrieve the CFTC report with
// its local first-seen provenance, so hiding a fetched or inferred value inside the script would
// misrepresent both its source and its availability time.
export const COT_CROWDING_UNWIND_OVERLAY_SOURCE = `//@version=6
indicator("${COT_CROWDING_UNWIND_OVERLAY_NAME}", overlay = true)

// COT values are explicit MCP inputs. This script does not fetch or infer CFTC data, orders, stops, or execution flow.
cotPercentile = input.float(50.0, "COT Percentile (3Y)", minval = 0.0, maxval = 100.0)
targetNetOiRatio = input.float(0.0, "Target Net OI Ratio %", minval = -100.0, maxval = 100.0)
cotReportDate = input.string("unassigned", "COT Report Date")
cotAvailableAt = input.string("unassigned", "COT Available At")
structureLookback = input.int(20, "Structure Lookback", minval = 5, maxval = 100)
showContextTable = input.bool(true, "Show Context Table")
volumeProfilePoc = input.string("unassigned", "Volume Profile POC")
volumeProfileVah = input.string("unassigned", "Volume Profile VAH")
volumeProfileVal = input.string("unassigned", "Volume Profile VAL")
volumeProfileTradingDay = input.string("unassigned", "Volume Profile Trading Day")
volumeProfileType = input.string("unassigned", "Volume Profile Type")
directCotFuturesCurrency = input.string("unassigned", "Direct COT Futures Currency")
directCotFuturesBias = input.string("unassigned", "Direct COT Futures % / Percentile")

support = ta.lowest(low[1], structureLookback)
resistance = ta.highest(high[1], structureLookback)
crowdedLong = cotPercentile >= 90.0
crowdedShort = cotPercentile <= 10.0
downsideBreak = close < support
upsideBreak = close > resistance
// These inputs describe the latest observed COT report. Do not project them onto earlier bars.
longUnwindProxy = barstate.islast and crowdedLong and downsideBreak
shortUnwindProxy = barstate.islast and crowdedShort and upsideBreak

var line supportLine = na
var line resistanceLine = na
if barstate.islast
    line.delete(supportLine)
    line.delete(resistanceLine)
    supportLine := line.new(bar_index - structureLookback, support, bar_index, support, extend = extend.right, color = color.new(color.red, 15), width = 2)
    resistanceLine := line.new(bar_index - structureLookback, resistance, bar_index, resistance, extend = extend.right, color = color.new(color.lime, 15), width = 2)
plotshape(longUnwindProxy, title = "Crowded Long Downside Unwind Proxy", style = shape.triangledown, location = location.abovebar, color = color.red, size = size.small, text = "COT unwind")
plotshape(shortUnwindProxy, title = "Crowded Short Upside Unwind Proxy", style = shape.triangleup, location = location.belowbar, color = color.lime, size = size.small, text = "COT unwind")
bgcolor(longUnwindProxy ? color.new(color.red, 88) : shortUnwindProxy ? color.new(color.lime, 88) : na)

var table context = table.new(position.bottom_right, 2, 8, border_width = 1)
if barstate.islast and showContextTable
    panelBackground = color.black
    state = longUnwindProxy ? "LONG CROWDING: DOWN BREAK" : shortUnwindProxy ? "SHORT CROWDING: UP BREAK" : crowdedLong ? "LONG CROWDING: WAIT" : crowdedShort ? "SHORT CROWDING: WAIT" : "NO EXTREME CROWDING"
    stateColor = longUnwindProxy ? color.red : shortUnwindProxy ? color.lime : crowdedLong or crowdedShort ? color.orange : color.silver
    table.cell(context, 0, 0, "COT + Volume Context", text_color = color.white, bgcolor = color.black)
    table.cell(context, 1, 0, state, text_color = stateColor, bgcolor = color.black)
    table.cell(context, 0, 1, "Pair COT % / net OI", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 1, str.tostring(cotPercentile, "#.0") + "% / " + str.tostring(targetNetOiRatio, "#.00") + "%", text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 2, "Direct " + directCotFuturesCurrency + " futures", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 2, directCotFuturesBias, text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 3, "20D support / resist", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 3, str.tostring(support, format.mintick) + " / " + str.tostring(resistance, format.mintick), text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 4, "Profile POC", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 4, volumeProfilePoc, text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 5, "VAH / VAL", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 5, volumeProfileVah + " / " + volumeProfileVal, text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 6, "Profile day", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 6, volumeProfileTradingDay, text_color = color.white, bgcolor = panelBackground)
    table.cell(context, 0, 7, "Volume source", text_color = color.silver, bgcolor = panelBackground)
    table.cell(context, 1, 7, volumeProfileType == "exchange_reported_volume" ? "exchange volume" : volumeProfileType, text_color = color.white, bgcolor = panelBackground)
`;
