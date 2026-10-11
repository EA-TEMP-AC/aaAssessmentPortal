type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <h1>{title}</h1>
      <p>{description}</p>
    </>
  );
}
