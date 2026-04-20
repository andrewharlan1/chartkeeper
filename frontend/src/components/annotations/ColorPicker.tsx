interface Props {
  colors: string[];
  selected: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ colors, selected, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {colors.map(color => {
        const isActive = color === selected;
        return (
          <button
            key={color}
            onClick={() => onChange(color)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 99,
              border: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              outline: isActive ? '2px solid var(--bg)' : 'none',
              background: color,
              cursor: 'pointer',
              padding: 0,
              boxSizing: 'border-box',
              transition: 'border-color 0.1s, outline 0.1s',
              flexShrink: 0,
            }}
            title={color}
          />
        );
      })}
    </div>
  );
}
