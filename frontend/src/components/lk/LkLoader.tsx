interface LkLoaderProps {
  text?: string;
  compact?: boolean;
}

export default function LkLoader({ text = "Loading . . . ", compact }: LkLoaderProps) {
  return (
    <div className={`flex items-center justify-center w-full ${compact ? "h-[200px]" : "min-h-[260px]"}`}>
      <div className={`uiverse-loader-wrap${compact ? " uiverse-loader-compact" : ""}`}>
        <div className="circ">
          <div className="load">{text}</div>
          <div className="hands"></div>
          <div className="body"></div>
          <div className="head">
            <div className="eye"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
