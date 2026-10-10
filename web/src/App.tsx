import { BrowserRouter, Route, Routes } from "react-router-dom";

function HomePage() {
  return (
    <main>
      <h1>AA Assessment Portal</h1>
      <p>Web shell placeholder. Feature UI lands in F-01+.</p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
