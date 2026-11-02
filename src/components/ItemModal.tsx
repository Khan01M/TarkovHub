// Окно предмета: большое изображение, характеристики, цены и где купить/продать.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../api';
import { rub, num } from '../api';
import { Img, safeUrl } from '../ui';
import { caliberName, penClass } from '../pages/Weapons';

const ASSETS = 'https://assets.tarkov.dev/';

/** Ссылка на лучшее изображение: для оружия — собранная версия (пресет), иначе сам предмет */
export function bigImageCandidates(it: Item): string[] {
  const id = it.gun?.preset || it.id;
  return [`${ASSETS}${id}-image.webp`, `${ASSETS}${id}-512.webp`, `${ASSETS}${it.id}-image.webp`, it.iconLink || ''].filter(Boolean);
}
/** Картинка для строки списка: оружие целиком на прозрачном фоне */
export function rowImage(it: Item): string | undefined {
  if (it.gun?.preset) return `${ASSETS}${it.gun.preset}-base-image.webp`;
  return it.iconLink;
}

function BigImage({ it }: { it: Item }) {
  const list = useMemo(() => bigImageCandidates(it), [it]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [it.id]);
  if (i >= list.length) return <div className="im-noimg">Нет изображения</div>;
  return <img className="im-img" src={list[i]} alt={it.name} onError={() => setI(i + 1)} />;
}

export default function ItemModal({ item, allItems, onClose, onOpen }: { item: Item; allItems?: Item[]; onClose: () => void; onOpen?: (it: Item) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const g = item.gun, a = item.ammo;
  const buy = [...item.buyFor].sort((x, y) => x.priceRUB - y.priceRUB);
  const sell = [...item.sellFor].sort((x, y) => y.priceRUB - x.priceRUB);
  // Для оружия — патроны этого калибра, лучшие по пробитию
  const ammo = useMemo(() => (g && allItems ? allItems.filter((x) => x.ammo?.caliber === g.caliber).sort((x, y) => y.ammo!.penetrationPower - x.ammo!.penetrationPower).slice(0, 8) : []), [g, allItems]);

  return (
    <div className="im-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="im-dialog" role="dialog" aria-modal="true" aria-label={item.name}>
        <button ref={closeRef} className="im-close" onClick={onClose} aria-label="Закрыть">✕</button>
        <div className="im-hero"><BigImage it={item} /></div>
        <div className="im-body">
          <h2>{item.name}</h2>
          <div className="im-tags">
            {g && <span className="tag">{caliberName(g.caliber)}</span>}
            {a && <span className="tag">{caliberName(a.caliber)}</span>}
            {!g && <span className="tag">{item.width}×{item.height} кл.</span>}
            {item.types.includes('noFlea') && <span className="badge bad">нельзя на барахолку</span>}
          </div>

          {g && (
            <div className="im-stats">
              <div className="stat"><b>{num(g.recoilVertical)}</b><span>Отдача верт.</span></div>
              <div className="stat"><b>{num(g.recoilHorizontal)}</b><span>Отдача гор.</span></div>
              <div className="stat"><b>{num(g.ergonomics)}</b><span>Эргономика</span></div>
              <div className="stat"><b>{num(g.fireRate)}</b><span>Выстр./мин</span></div>
            </div>
          )}
          {g?.defaultAmmo && <div className="muted small">Патрон по умолчанию: {g.defaultAmmo}</div>}
          {a && (
            <div className="im-stats">
              <div className="stat"><b>{a.projectileCount > 1 ? `${a.damage}×${a.projectileCount}` : a.damage}</b><span>Урон</span></div>
              <div className="stat"><b><span className={`pen pen${penClass(a.penetrationPower)}`}>{a.penetrationPower}</span></b><span>Пробитие</span></div>
              <div className="stat"><b>{a.armorDamage}%</b><span>Урон броне</span></div>
              <div className="stat"><b>{a.initialSpeed}</b><span>Скорость, м/с</span></div>
            </div>
          )}

          <div className="im-prices">
            <div>
              <h4>Купить</h4>
              {buy.length ? buy.map((o, i) => <div key={i} className="kv"><span>{o.vendor.name}</span><b>{rub(o.priceRUB)}</b></div>) : <div className="muted small">Нигде не продаётся</div>}
            </div>
            <div>
              <h4>Продать</h4>
              {sell.length ? sell.slice(0, 6).map((o, i) => <div key={i} className="kv"><span>{o.vendor.name}</span><b>{rub(o.priceRUB)}</b></div>) : <div className="muted small">Торговцы не берут</div>}
            </div>
          </div>
          {item.avg24hPrice ? (
            <div className="muted small">
              Барахолка: средняя за 24 ч {rub(item.avg24hPrice)}{item.low24hPrice ? ` · минимум ${rub(item.low24hPrice)}` : ''}
              {item.changeLast48hPercent ? ` · за 48 ч ${item.changeLast48hPercent > 0 ? '+' : ''}${num(item.changeLast48hPercent, 1)}%` : ''}
            </div>
          ) : null}

          {ammo.length > 0 && (
            <>
              <h4>Патроны этого калибра</h4>
              <div className="im-ammo">
                {ammo.map((x) => (
                  <button key={x.id} className="im-ammo-item" onClick={() => onOpen?.(x)} title={x.name}>
                    <Img src={x.iconLink} alt="" size={32} />
                    <span className="grow">{x.shortName}</span>
                    <span className={`pen pen${penClass(x.ammo!.penetrationPower)}`}>{x.ammo!.penetrationPower}</span>
                    <span className="muted small">урон {x.ammo!.damage}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {safeUrl(item.wikiLink) && <a className="link" href={safeUrl(item.wikiLink)} target="_blank" rel="noreferrer">Подробнее в Wiki ↗</a>}
        </div>
      </div>
    </div>
  );
}
