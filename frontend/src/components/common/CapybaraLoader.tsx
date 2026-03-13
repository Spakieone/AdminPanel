interface CapybaraLoaderProps {
  text?: string;
  fullScreen?: boolean;
}

export default function CapybaraLoader({ text = "Loading . . . ", fullScreen = false }: CapybaraLoaderProps) {
  return (
    <div className={`flex items-center justify-center w-full ${fullScreen ? "min-h-screen" : "min-h-[260px]"}`}>
      <div className="uiverse-loader-wrap">
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
