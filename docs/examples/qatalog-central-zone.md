> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Page: Qatalog Central Zone

## Description

Voici le découpage composant par composant de la **zone centrale** (le bloc principal d'interaction et la grille d'actions sous-jacente) :

---

### 1. Le bloc d'en-tête central

* **Icône de marque :** Un symbole géométrique filiforme noir (forme d'hexagone/cubes empilés) placé en haut au centre.
* **Titre de bienvenue :** Un texte en typographie *sans-serif*, taille moyenne, affichant simplement **`Hello!`**.

---

### 2. Le composant de saisie principal (Chat / Prompt Input Box)

C'est la pièce maîtresse de la zone centrale, conçue sous la forme d'un grand conteneur rectangulaire blanc aux coins arrondis, légèrement surélevé par une ombre portée subtile.

* **Zone de texte supérieure :**
* **Curseur actif :** Une barre verticale noire clignotante au début de la ligne.
* **Placeholder (Texte d'invite) :** Le message d'aide `How can I help?` écrit en gris clair.


* **Barre d'outils inférieure (Intégrée au conteneur) :**
* **Bouton de filtre de connexion (Dropdown) :**
* Situé à gauche.
* Un badge oblong à bordure fine contenant une icône de maillon/infini (`∞`), le texte **`All connections`**, et un chevron vers le bas (`∨`) indiquant un menu déroulant.


* **Icône Recherche :** Une petite loupe noire à côté du dropdown.
* **Icône Export/Upload :** Un carré surmonté d'une flèche vers le haut (`↑`) à côté de la loupe.
* **Bouton d'envoi :**
* Situé à l'extrême droite.
* Un bouton circulaire gris clair contenant une flèche vers la droite (`→`), actuellement grisé/inactif tant qu'aucune réponse n'est tapée.





---

### 3. La grille de cartes d'action (Action Cards Grid)

Située directement sous le champ de saisie, séparée par un espace blanc généreux. Elle est composée de **4 cartes verticales** séparées par de fines lignes verticales d'intersection (diviseurs).

Chaque carte suit une structure identique à 3 niveaux :

#### Carte 1 : *Add a connection*

* **Icône :** Un nœud/étincelle à quatre branches.
* **Titre & Texte :** **`Add a connection`** suivit de la description *« Connect your data sources. »*
* **Bouton d'action :** Un bouton rectangulaire arrondi avec la mention **`Connect`**.

#### Carte 2 : *Configure connections*

* **Icône :** Un engrenage à cran.
* **Titre & Texte :** **`Configure connections`** suivit de la description *« Learn how to easily connect your information sources. »*
* **Bouton d'action :** Un bouton rectangulaire arrondi avec un pictogramme *Play* **`▷ Watch`** (indiquant un format tutoriel vidéo).

#### Carte 3 : *Explore Search*

* **Icône :** Un groupe de trois étincelles/étoiles.
* **Titre & Texte :** **`Explore Search`** suivit de la description *« Discover how Qatalog helps you find answers instantly. »*
* **Bouton d'action :** Un bouton rectangulaire arrondi avec la mention **`▷ Watch`**.

#### Carte 4 : *Invite your team*

* **Icône :** Un buste d'utilisateur flanqué d'un signe plus (`+`).
* **Titre & Texte :** **`Invite your team`** suivit de la description *« Give your team instant access to Qatalog. »*
* **Bouton d'action :** Un bouton rectangulaire arrondi avec la mention **`Invite`**.

## Reproduction HTML/CSS

    ```html
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Qatalog Central Zone</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
<style>
  @import url('https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap');
  * { font-family: 'General Sans', sans-serif; }
</style>
</head>
<body>
<div class="min-h-screen bg-gradient-to-b from-white via-gray-50 to-gray-100 flex items-start justify-center pt-24 px-4" data-sd-id="1">
  <div class="w-full max-w-[610px] flex flex-col items-center" data-sd-id="2">

    <!-- Icon + Greeting -->
    <div class="w-full flex flex-col items-start mb-6" data-sd-id="3">
      <div class="w-9 h-9 flex items-center justify-center mb-4" data-sd-id="4">
        <iconify-icon icon="lucide:hexagon" class="text-[28px] text-gray-900"></iconify-icon>
      </div>
      <h1 class="text-2xl font-medium text-gray-900 tracking-tight" data-sd-id="5">Hello!</h1>
    </div>

    <!-- Search / Prompt Box -->
    <div class="w-full bg-white border border-gray-200 rounded-2xl shadow-sm mb-16" data-sd-id="6">
      <div class="px-5 pt-5 pb-4" data-sd-id="7">
        <textarea class="w-full h-16 resize-none outline-none text-[15px] text-gray-800 placeholder-gray-400" placeholder="How can I help?" data-sd-id="8"></textarea>
      </div>
      <div class="flex items-center justify-between px-4 pb-4" data-sd-id="9">
        <div class="flex items-center gap-2" data-sd-id="10">
          <button class="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors" data-sd-id="11">
            <iconify-icon icon="lucide:infinity" class="text-base text-gray-500"></iconify-icon>
            <span class="font-medium" data-sd-id="12">All connections</span>
            <iconify-icon icon="lucide:chevron-down" class="text-sm text-gray-400"></iconify-icon>
          </button>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors" data-sd-id="13">
            <iconify-icon icon="lucide:search" class="text-base text-gray-500"></iconify-icon>
          </button>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors" data-sd-id="14">
            <iconify-icon icon="lucide:upload" class="text-base text-gray-500"></iconify-icon>
          </button>
        </div>
        <button id="submit-prompt-btn" class="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors" data-sd-id="15">
          <iconify-icon icon="lucide:arrow-right" class="text-base text-gray-500"></iconify-icon>
        </button>
      </div>
    </div>

    <!-- Feature Cards Grid -->
    <div class="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-gray-200" data-sd-id="16">
      <!-- Card 1 -->
      <div class="flex flex-col items-start pt-0 lg:px-6 lg:first:pl-0 pb-6 sm:pb-0 sm:pr-6" data-sd-id="17">
        <iconify-icon icon="lucide:plug" class="text-lg text-gray-500 mb-4"></iconify-icon>
        <h3 class="text-[15px] font-medium text-gray-900 mb-1.5" data-sd-id="18">Add a connection</h3>
        <p class="text-sm text-gray-500 leading-relaxed mb-6" data-sd-id="19">Connect your data sources.</p>
        <button class="mt-auto border border-gray-200 rounded-lg px-4 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors" data-sd-id="20">
          Connect
        </button>
      </div>
      <!-- Card 2 -->
      <div class="flex flex-col items-start pt-6 sm:pt-0 lg:px-6 pb-6 sm:pb-0 sm:pl-6 lg:pr-6" data-sd-id="21">
        <iconify-icon icon="lucide:settings" class="text-lg text-gray-500 mb-4"></iconify-icon>
        <h3 class="text-[15px] font-medium text-gray-900 mb-1.5" data-sd-id="22">Configure connections</h3>
        <p class="text-sm text-gray-500 leading-relaxed mb-6" data-sd-id="23">Learn how to easily connect your information sources.</p>
        <button class="mt-auto flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors" data-sd-id="24">
          <iconify-icon icon="lucide:play" class="text-xs"></iconify-icon>
          Watch
        </button>
      </div>
      <!-- Card 3 -->
      <div class="flex flex-col items-start pt-6 lg:pt-0 lg:px-6 pb-6 sm:pb-0 sm:pr-6" data-sd-id="25">
        <iconify-icon icon="lucide:sparkles" class="text-lg text-gray-500 mb-4"></iconify-icon>
        <h3 class="text-[15px] font-medium text-gray-900 mb-1.5" data-sd-id="26">Explore Search</h3>
        <p class="text-sm text-gray-500 leading-relaxed mb-6" data-sd-id="27">Discover how Qatalog helps you find answers instantly.</p>
        <button class="mt-auto flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors" data-sd-id="28">
          <iconify-icon icon="lucide:play" class="text-xs"></iconify-icon>
          Watch
        </button>
      </div>
      <!-- Card 4 -->
      <div class="flex flex-col items-start pt-6 lg:pt-0 lg:px-6 lg:last:pr-0 sm:pl-6" data-sd-id="29">
        <iconify-icon icon="lucide:user-plus" class="text-lg text-gray-500 mb-4"></iconify-icon>
        <h3 class="text-[15px] font-medium text-gray-900 mb-1.5" data-sd-id="30">Invite your team</h3>
        <p class="text-sm text-gray-500 leading-relaxed mb-6" data-sd-id="31">Give your team instant access to Qatalog.</p>
        <button class="mt-auto border border-gray-200 rounded-lg px-4 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors" data-sd-id="32">
          Invite
        </button>
      </div>
    </div>

  </div>
</div>


</body></html>
```

Please reference this design and implement it into our codebase; Try to understand the structure, which part of our codebase is relevant and implement
