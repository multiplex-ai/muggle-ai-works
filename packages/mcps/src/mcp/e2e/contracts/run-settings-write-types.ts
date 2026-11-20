/** Field of a project lane's managed login profile; the string values are the prompt-service wire format. */
export enum ManagedProfileFieldEnum {
  Email = "managed_profile_email",
  FirstName = "managed_profile_first_name",
  LastName = "managed_profile_last_name",
  DateOfBirth = "managed_profile_date_of_birth",
  Username = "managed_profile_username",
  Password = "managed_profile_password",
  Phone = "managed_profile_phone",
  TotpSecret = "managed_profile_totp_secret",
}
