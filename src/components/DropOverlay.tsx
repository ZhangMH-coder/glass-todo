export default function DropOverlay(): React.JSX.Element {
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone__inner">
        <div className="dropzone__icon">⤓</div>
        <div className="dropzone__title">松手即可解析文件</div>
        <p className="dropzone__hint">
          支持 txt / md / log / csv / tsv / json / docx
          <br />
          解析后会先显示预览，确认无误再写入
        </p>
      </div>
    </div>
  )
}
