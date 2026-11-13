"""GitHub Pages에 필요한 정적 파일만 dist에 모은다."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
destination = root / "dist"
destination.mkdir(exist_ok=True)
for name in ("index.html", "styles.css", "favicon.svg"):
    shutil.copy2(root / name, destination / name)
for name in ("src", "vendor", "data"):
    shutil.copytree(root / name, destination / name, dirs_exist_ok=True)
(destination / ".nojekyll").touch()
print(f"GitHub Pages 파일 준비 완료: {destination}")
