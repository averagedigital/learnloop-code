import { useState } from "react";

const mascotFrames = Array.from({ length: 12 }, (_, index) => {
  return `/assets/mascots/05_laptop_spiky/frames/idle/frame_${String(index + 1).padStart(2, "0")}.png`;
});

export default function App() {
  const [frameIndex, setFrameIndex] = useState(0);

  return (
    <main className="posterShell" aria-labelledby="hero-title">
      <nav className="posterNav" aria-label="Главная">
        <a className="wordmark" href="/" aria-label="CodeLearnML">
          CodeLearnML
        </a>
      </nav>

      <section className="heroPoster">
        <div className="heroCopy posterCenter">
          <p className="monoStamp">LOCAL CODE PRACTICE / LLM LESSONS / REAL CHECKS</p>
          <h1 id="hero-title" className="heroTitle" aria-label="Какой код пишем?">
            <span className="headlineStack">
              <span>КАКОЙ</span>
              <span>КОД</span>
            </span>
            <span className="mascotPeek" aria-hidden="true">
              <img
                className="peekMascot"
                src={mascotFrames[frameIndex]}
                alt=""
                onAnimationIteration={() => setFrameIndex((frameIndex + 1) % mascotFrames.length)}
              />
            </span>
            <span className="headlineStack">
              <span>ПИШЕМ?</span>
            </span>
          </h1>
          <div className="heroActionRow">
            <a className="posterAction" href="/api/app-state">
              Реди
            </a>
          </div>
        </div>
        <span className="srOnly">Маскот-наставник CodeLearnML выглядывает из заголовка.</span>
      </section>
    </main>
  );
}
