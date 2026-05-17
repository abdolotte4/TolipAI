export default function AuroraBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-slate-950">
      <div className="absolute -top-[40%] -left-[20%] h-[800px] w-[800px] rounded-full bg-violet-600/20 blur-[120px] animate-pulse" />
      <div
        className="absolute top-[20%] -right-[20%] h-[600px] w-[600px] rounded-full bg-fuchsia-600/15 blur-[100px] animate-pulse"
        style={{ animationDelay: "2s" }}
      />
      <div
        className="absolute -bottom-[20%] left-[30%] h-[700px] w-[700px] rounded-full bg-cyan-600/10 blur-[130px] animate-pulse"
        style={{ animationDelay: "4s" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
    </div>
  );
}
