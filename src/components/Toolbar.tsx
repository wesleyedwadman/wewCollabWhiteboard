import type { Tool } from "../types/whiteboard";


export function Toolbar(
{
tool, stroke, fill, strokeWidth,
onTool, onStroke, onFill, onTransparentFill, onWidth,
onUndo, onRedo, onClear, onExport, onImportImage,
}: {
tool: Tool;
stroke: string;
fill: string;
strokeWidth: number;
onTool: (t: Tool) => void;
onStroke: (v: string) => void;
onFill: (v: string) => void;
onTransparentFill: () => void;
onWidth: (n: number) => void;
onUndo: () => void;
onRedo: () => void;
onClear: () => void;
onExport: () => void;
onImportImage: () => void;
}
) {

// - UI -

return (

// Active Tool

<div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow">
<ToolButton label="Select" active={tool === "select"} onClick={() => onTool("select")} />
<ToolButton label="Pen" active={tool === "pen"} onClick={() => onTool("pen")} />
<ToolButton label="Line" active={tool === "line"} onClick={() => onTool("line")} />
<ToolButton label="Rect" active={tool === "rect"} onClick={() => onTool("rect")} />
<ToolButton label="Ellipse" active={tool === "ellipse"} onClick={() => onTool("ellipse")} />
<ToolButton label="Erase" active={tool === "erase"} onClick={() => onTool("erase")} />


<div className="w-px h-6 bg-gray-200 mx-1" />


<label className="flex items-center gap-2 text-sm">
Stroke
<input type="color" value={stroke} onChange={(e) => onStroke(e.target.value)} />
</label>
<label className="flex items-center gap-2 text-sm">
Fill
<input type="color" value={fill === "transparent" ? "#ffffff" : fill} onChange={(e) => onFill(e.target.value)} />
<button className="px-2 py-1 rounded-md bg-gray-100 text-xs" onClick={onTransparentFill}>Transparent</button>
</label>
<label className="flex items-center gap-2 text-sm">
Width
<input type="range" min={1} max={20} value={strokeWidth} onChange={(e) => onWidth(parseInt(e.target.value))} />
<span className="w-8 text-right text-xs">{strokeWidth}px</span>
</label>


<div className="w-px h-6 bg-gray-200 mx-1" />


<button onClick={onUndo} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Undo</button>
<button onClick={onRedo} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Redo</button>
<button onClick={onClear} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Clear</button>
<button onClick={onExport} className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-sm">Export PNG</button>
<button onClick={onImportImage} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm shadow">Import Image</button>
</div>
);
}


function ToolButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
return (
<button
onClick={onClick}
className={`px-3 py-1.5 rounded-xl text-sm shadow border ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200"}`}
>
{label}
</button>
);
}