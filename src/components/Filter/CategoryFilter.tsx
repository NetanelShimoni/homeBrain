/**
 * Category filter component.
 * Allows users to filter RAG queries by device category.
 */
import React from "react";

interface CategoryFilterProps {
  categories: string[];
  selected: string | undefined;
  onChange: (category: string | undefined) => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  selected,
  onChange,
}) => {
  return (
    <div className="filter-section">
      <h3>🔍 סינון לפי קטגוריה</h3>

      <div className="category-chips">
        <button
          className={`category-chip ${!selected ? "active" : ""}`}
          onClick={() => onChange(undefined)}
        >
          הכל
        </button>

        {categories.map((category) => (
          <button
            key={category}
            className={`category-chip ${selected === category ? "active" : ""}`}
            onClick={() =>
              onChange(selected === category ? undefined : category)
            }
          >
            {category}
          </button>
        ))}
      </div>

      {categories.length === 0 && (
        <p className="filter-empty">העלה מסמכים כדי לראות קטגוריות</p>
      )}
    </div>
  );
};
