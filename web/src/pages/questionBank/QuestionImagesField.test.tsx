import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { QuestionImageRef } from "../../api/questionImages";
import { QuestionImagesField } from "./QuestionImagesField";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

function Harness({ start = [] as QuestionImageRef[] }) {
  const [images, setImages] = useState(start);
  return <QuestionImagesField images={images} onChange={setImages} />;
}

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

it("uploads a picture and asks for its description (X-25)", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ id: "a".repeat(24), contentType: "image/png", size: 10 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(new Blob(["x"], { type: "image/png" }), { status: 200 });
  });
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(screen.getByLabelText("Add a picture"), file("a.png", "image/png"));
  expect(await screen.findByLabelText("Description of picture 1")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Description of picture 1"), "A wiring diagram");
  expect(screen.getByLabelText("Description of picture 1")).toHaveValue("A wiring diagram");
  await waitFor(() => expect(screen.getByRole("img", { name: "A wiring diagram" })).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Remove picture 1" }));
  expect(screen.queryByLabelText("Description of picture 1")).not.toBeInTheDocument();
});

it("refuses a wrong type or a big file before sending anything", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<Harness />);
  await user.upload(screen.getByLabelText("Add a picture"), file("a.gif", "image/gif"));
  expect(await screen.findByRole("alert")).toHaveTextContent("PNG or JPEG");
  await user.upload(screen.getByLabelText("Add a picture"), file("b.png", "image/png", 2 * 1024 * 1024));
  expect(await screen.findByRole("alert")).toHaveTextContent("larger than 1 MB");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("stops offering uploads at three pictures", () => {
  fetchMock.mockImplementation(async () => new Response(new Blob(["x"]), { status: 200 }));
  render(
    <Harness
      start={[1, 2, 3].map((n) => ({ imageId: String(n).repeat(24), alt: `p${n}` }))}
    />,
  );
  expect(screen.queryByLabelText("Add a picture")).not.toBeInTheDocument();
});
