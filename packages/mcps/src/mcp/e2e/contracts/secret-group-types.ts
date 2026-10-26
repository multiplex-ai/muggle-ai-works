/** Kind of typed secret group; the string values are the prompt-service wire format. */
export enum SecretTypeEnum {
  LOGIN_CREDENTIAL = "login_credential",
  PAYMENT_CARD = "payment_card",
}

/** Field of a typed secret group; the string values are the prompt-service wire format. */
export enum SecretFieldEnum {
  USERNAME = "username",
  PASSWORD = "password",
  CARDHOLDER_NAME = "cardholder_name",
  CARD_NUMBER = "card_number",
  EXPIRY = "expiry",
  CVC = "cvc",
  BILLING_POSTAL_CODE = "billing_postal_code",
}
