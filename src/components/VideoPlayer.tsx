import { useEffect, useRef } from "react";
import shaka from "shaka-player";

export default function VideoPlayer({ url }: any) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const player = new shaka.Player(ref.current!);

    player.load(url).catch(() => {
      ref.current!.src = url;
    });

    return () => player.destroy();
  }, [url]);

  return (
    <video
      ref={ref}
      autoPlay
      controls
      style={{
        position: "fixed",
        width: "100%",
        height: "100%",
        zIndex: 10,
        background: "black"
      }}
    />
  );
}
