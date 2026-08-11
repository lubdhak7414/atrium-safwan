export function TitleBlock({ title, meta }: { title: string; meta: string }) {
  return (
    <header className="title-block">
      <div className="title-block-brand">ATRIUM COACHING CENTRE</div>
      <div className="title-block-main">
        <h1>{title}</h1>
        <div className="title-block-meta">{meta}</div>
      </div>
    </header>
  );
}
