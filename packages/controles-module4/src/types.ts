// Convention par défaut (Plan Comptable Général) : quel taux nominal chaque
// sous-compte de TVA collectée représente. C'est un REPLI, pas la source
// principale — voir coherenceTaux.ts : un dossier avec un historique connu
// (taux_historique) est vérifié contre SA propre convention en priorité,
// pas contre cette table nationale.
export const TAUX_NOMINAL_PAR_DEFAUT: Record<string, number> = {
  '445711': 20,
  '445712': 10,
  '445713': 5.5,
  '445714': 2.1,
};
